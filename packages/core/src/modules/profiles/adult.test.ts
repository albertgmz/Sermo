import { describe, expect, test } from "bun:test";
import { createTestContext, insertUser, userActor } from "@sermo/core/testing";
import { GUEST } from "../../actor";
import { ConflictError, ForbiddenError, UnauthenticatedError, ValidationError } from "../../errors";
import { execute } from "../../operation";
import { getOperation } from "../../operations";
import { adultFrom, adultRefusalFor } from "../../permissions";
import { updateSiteSettings } from "../settings";

/** A member and an administrator; the clock starts on 1 January 2026 and the +18 mode is on. */
function setup() {
  const ctx = createTestContext();
  const admin = userActor(insertUser(ctx, { groupId: 4 }));
  const user = insertUser(ctx);
  const member = userActor(user);
  updateSiteSettings(ctx, admin, { adultMode: true });
  // biome-ignore lint/suspicious/noExplicitAny: operations are called by name, their output is loosely typed
  const call = (name: string, actor = member, input: object = {}): Promise<any> =>
    execute(ctx, getOperation(name), actor, input);
  const stored = () =>
    ctx.sqlite
      .prepare<
        { birth_year: number | null; birthday_md: string | null; adult_accepted_at: number | null },
        [number]
      >("SELECT birth_year, birthday_md, adult_accepted_at FROM users WHERE id = ?1")
      .get(user.id)!;
  return { ctx, admin, user, member, call, stored };
}

describe("profiles.setBirthDate", () => {
  test("stores a missing date once, and the member's standing follows it", async () => {
    const { call, stored, member, ctx } = setup();
    expect(adultRefusalFor(ctx, member)).toBe("birthDate");
    expect(await call("profiles.setBirthDate", member, { year: 1990, month: 2, day: 3 })).toEqual({
      refusal: "acceptance",
    });
    expect(stored()).toMatchObject({ birth_year: 1990, birthday_md: "02-03" });
    await expect(
      call("profiles.setBirthDate", member, { year: 2000, month: 2, day: 3 }),
    ).rejects.toThrow(ForbiddenError);
    expect(stored()).toMatchObject({ birth_year: 1990, birthday_md: "02-03" });
  });

  test("a day kept without its year is no full date: the window may still store one", async () => {
    const { call, stored, member } = setup();
    await call("profiles.update", member, { birthday: { month: 7, day: 8 } });
    await call("profiles.setBirthDate", member, { year: 2012, month: 7, day: 8 });
    expect(stored()).toMatchObject({ birth_year: 2012, birthday_md: "07-08" });
  });

  test("refuses a date that does not exist or lies in the future, and guests", async () => {
    const { call, stored, member } = setup();
    await expect(
      call("profiles.setBirthDate", member, { year: 2001, month: 2, day: 29 }),
    ).rejects.toThrow(ValidationError);
    await expect(
      call("profiles.setBirthDate", member, { year: 2026, month: 1, day: 2 }),
    ).rejects.toThrow(ValidationError);
    expect(stored().birth_year).toBeNull();
    await expect(
      call("profiles.setBirthDate", GUEST, { year: 1990, month: 1, day: 1 }),
    ).rejects.toThrow(UnauthenticatedError);
  });

  test("once set, only staff change it: the member's own profile edit is refused while the mode is on", async () => {
    const { call, stored, member, admin, user, ctx } = setup();
    await call("profiles.setBirthDate", member, { year: 2010, month: 5, day: 6 });
    await expect(
      call("profiles.update", member, { birthday: { year: 1990, month: 5, day: 6 } }),
    ).rejects.toThrow(ForbiddenError);
    await expect(call("profiles.update", member, { birthday: null })).rejects.toThrow(
      ForbiddenError,
    );
    // The stored date sent again changes nothing and passes.
    await call("profiles.update", member, { birthday: { year: 2010, month: 5, day: 6 } });
    expect(stored()).toMatchObject({ birth_year: 2010, birthday_md: "05-06" });
    await call("users.adminUpdateProfile", admin, {
      userId: user.id,
      birthday: { year: 1995, month: 5, day: 6 },
    });
    expect(stored()).toMatchObject({ birth_year: 1995, birthday_md: "05-06" });
    // With the mode off the profile edit is the member's again.
    updateSiteSettings(ctx, admin, { adultMode: false });
    await call("profiles.update", member, { birthday: { year: 1996, month: 5, day: 6 } });
    expect(stored().birth_year).toBe(1996);
  });
});

describe("profiles.acceptAdult", () => {
  test("needs a full date of birth, refuses a minor, and records the first time for an adult", async () => {
    const { call, stored, member, ctx } = setup();
    await expect(call("profiles.acceptAdult")).rejects.toThrow(ConflictError);
    await call("profiles.setBirthDate", member, { year: 2008, month: 1, day: 2 });
    // One day short of 18.
    await expect(call("profiles.acceptAdult")).rejects.toThrow(ForbiddenError);
    expect(stored().adult_accepted_at).toBeNull();
    ctx.clock.advance(86_400_000);
    expect(await call("profiles.acceptAdult")).toEqual({ refusal: null });
    const first = stored().adult_accepted_at;
    expect(first).toBe(ctx.now());
    ctx.clock.advance(60_000);
    await call("profiles.acceptAdult");
    expect(stored().adult_accepted_at).toBe(first);
    expect(adultRefusalFor(ctx, member)).toBeNull();
    await expect(call("profiles.acceptAdult", GUEST)).rejects.toThrow(UnauthenticatedError);
  });

  test("a member who confirmed and turns out a minor (staff changed the date) is refused again", async () => {
    const { call, member, admin, user, ctx } = setup();
    await call("profiles.setBirthDate", member, { year: 1990, month: 1, day: 1 });
    await call("profiles.acceptAdult");
    await call("users.adminUpdateProfile", admin, {
      userId: user.id,
      birthday: { year: 2012, month: 1, day: 1 },
    });
    expect(adultRefusalFor(ctx, member)).toBe("minor");
  });
});

test("18 years are counted from the birth date in UTC; 29 February turns 18 on 1 March", () => {
  expect(adultFrom(2008, "01-01")).toBe(Date.UTC(2026, 0, 1));
  expect(adultFrom(2008, "02-29")).toBe(Date.UTC(2026, 2, 1));
  expect(adultFrom(null, "01-01")).toBeNull();
  expect(adultFrom(2008, null)).toBeNull();
});
