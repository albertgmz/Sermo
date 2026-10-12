import { describe, expect, test } from "bun:test";
import { GUEST } from "../../actor";
import { ForbiddenError, UnauthenticatedError, ValidationError } from "../../errors";
import { expectNoTableScan } from "../../testing";
import { type World, world } from "../members/fixtures.test";
import { PROFILE_SQL } from "./posts";

const update = (w: World, actor: object, input: object) => w.call("profiles.update", actor, input);
const stored = (w: World, id: number, column: string) =>
  w.ctx.sqlite
    .prepare<Record<string, unknown>, [number]>(`SELECT ${column} FROM users WHERE id = ?1`)
    .get(id)?.[column];

describe("profiles.update", () => {
  test("an empty input changes nothing and returns the profile", async () => {
    const w = world();
    await update(w, w.memberActor, { about: "hello", location: "Madrid" });
    const before = stored(w, w.member.id, "content_updated_at");
    w.ctx.clock.advance(1000);
    const profile = await update(w, w.memberActor, {});
    expect(profile).toMatchObject({ id: w.member.id, about: "hello", location: "Madrid" });
    expect(stored(w, w.member.id, "content_updated_at")).toBe(before);
  });

  test("each field alone changes only that field", async () => {
    const w = world();
    const fields: [object, Record<string, unknown>][] = [
      [{ about: "About me" }, { about: "About me" }],
      [{ location: "Lima" }, { location: "Lima" }],
      [{ website: "https://example.test/me" }, { website: "https://example.test/me" }],
      [{ socials: { discord: "me#1" } }, { socials: { discord: "me#1", telegram: "", x: "" } }],
      [{ socials: { x: "handle" } }, { socials: { discord: "me#1", telegram: "", x: "handle" } }],
      [
        { socials: { telegram: "tg" } },
        { socials: { discord: "me#1", telegram: "tg", x: "handle" } },
      ],
      [{ birthday: { month: 5, day: 17 } }, { birthday: { month: 5, day: 17 } }],
    ];
    let profile: Record<string, unknown> = {};
    for (const [input, expected] of fields) {
      profile = await update(w, w.memberActor, input);
      expect(profile).toMatchObject(expected);
    }
    // Everything set earlier is still there after the last single-field update.
    expect(profile).toMatchObject({
      about: "About me",
      location: "Lima",
      website: "https://example.test/me",
      socials: { discord: "me#1", telegram: "tg", x: "handle" },
      birthday: { month: 5, day: 17 },
    });
  });

  test("a change bumps content_updated_at and publishes the edit event", async () => {
    const w = world();
    w.ctx.clock.advance(5000);
    await update(w, w.memberActor, { location: "Quito" });
    expect(stored(w, w.member.id, "content_updated_at")).toBe(w.ctx.now());
    const event = w.ctx.sqlite
      .prepare<{ n: number }, [number]>(
        "SELECT count(*) AS n FROM domain_events WHERE type = 'content.edited' AND target_id = ?1",
      )
      .get(w.member.id);
    expect(event?.n).toBe(1);
  });

  test("the website is empty or an http(s) URL", async () => {
    const w = world();
    await expect(update(w, w.memberActor, { website: "javascript:alert(1)" })).rejects.toThrow();
    await expect(update(w, w.memberActor, { website: "ftp://example.test" })).rejects.toThrow();
    await update(w, w.memberActor, { website: "http://example.test" });
    expect((await update(w, w.memberActor, { website: "" })).website).toBe("");
  });

  test("the birthday is checked against the calendar and the year never published", async () => {
    const w = world();
    const set = (birthday: object | null) => update(w, w.memberActor, { birthday });
    await expect(set({ month: 2, day: 30 })).rejects.toBeInstanceOf(ValidationError);
    await expect(set({ month: 4, day: 31 })).rejects.toBeInstanceOf(ValidationError);
    await expect(set({ month: 2, day: 29, year: 2001 })).rejects.toBeInstanceOf(ValidationError);
    await expect(set({ month: 1, day: 1, year: 2100 })).rejects.toBeInstanceOf(ValidationError);
    expect((await set({ month: 2, day: 29 })).birthday).toEqual({ month: 2, day: 29 });
    expect(stored(w, w.member.id, "birthday_md")).toBe("02-29");
    expect(stored(w, w.member.id, "birth_year")).toBeNull();
    const withYear = await set({ month: 3, day: 9, year: 1990 });
    expect(withYear.birthday).toEqual({ month: 3, day: 9 });
    expect(JSON.stringify(withYear)).not.toContain("1990");
    expect(stored(w, w.member.id, "birthday_md")).toBe("03-09");
    expect(stored(w, w.member.id, "birth_year")).toBe(1990);
    expect((await set({ month: 2, day: 29, year: 2000 })).birthday).toEqual({ month: 2, day: 29 });
    expect((await set(null)).birthday).toBeNull();
    expect(stored(w, w.member.id, "birthday_md")).toBeNull();
    expect(stored(w, w.member.id, "birth_year")).toBeNull();
  });

  test("a birthday later this year is in the future, an earlier one is not", async () => {
    const w = world();
    // The test clock starts on 2026-01-01.
    await expect(
      update(w, w.memberActor, { birthday: { month: 6, day: 1, year: 2026 } }),
    ).rejects.toBeInstanceOf(ValidationError);
    await update(w, w.memberActor, { birthday: { month: 1, day: 1, year: 2026 } });
    await update(w, w.memberActor, { birthday: { month: 12, day: 31, year: 2025 } });
  });

  describe("custom title", () => {
    test("needs profile.customTitle to set one; clearing is always allowed", async () => {
      const w = world();
      await expect(update(w, w.memberActor, { customTitle: "Boss" })).rejects.toBeInstanceOf(
        ForbiddenError,
      );
      expect((await update(w, w.memberActor, { customTitle: null })).customTitle).toBeNull();
      await expect(update(w, GUEST, { customTitle: "x" })).rejects.toBeInstanceOf(
        UnauthenticatedError,
      );
      const unconfirmed = w.user({ groupId: 5 });
      await expect(
        update(
          w,
          { kind: "user", userId: unconfirmed.id, groupId: 5, sessionId: 0 },
          { customTitle: "x" },
        ),
      ).rejects.toBeInstanceOf(Error);
    });

    test("collapses whitespace, empty clears, and stores NULL", async () => {
      const w = world();
      const profile = await update(w, w.moderatorActor, { customTitle: "  The   big\n\tboss " });
      expect(profile.customTitle).toBe("The big boss");
      expect(profile.card.title).toBe("The big boss");
      expect((await update(w, w.moderatorActor, { customTitle: "   " })).customTitle).toBeNull();
      expect(stored(w, w.moderator.id, "custom_title")).toBeNull();
      await update(w, w.moderatorActor, { customTitle: "again" });
      expect((await update(w, w.moderatorActor, { customTitle: null })).customTitle).toBeNull();
    });

    test("the length limit is the site setting", async () => {
      const w = world();
      const title = "x".repeat(20);
      await update(w, w.moderatorActor, { customTitle: title });
      await w.call("settings.update", w.adminActor, { customTitleMaxLength: 10 });
      await expect(update(w, w.moderatorActor, { customTitle: title })).rejects.toBeInstanceOf(
        ValidationError,
      );
      await update(w, w.moderatorActor, { customTitle: "x".repeat(10) });
      await w.call("settings.update", w.adminActor, { customTitleMaxLength: 30 });
      await update(w, w.moderatorActor, { customTitle: title });
    });

    test("a title stays stored but stops showing when the permission is lost", async () => {
      const w = world();
      await update(w, w.moderatorActor, { customTitle: "Boss" });
      w.ctx.sqlite.run(`UPDATE users SET group_id = 2 WHERE id = ${w.moderator.id}`);
      const profile = await w.call("profiles.get", w.memberActor, { userId: w.moderator.id });
      expect(profile.customTitle).toBeNull();
      expect(profile.card.title).toBe("Member");
      expect(stored(w, w.moderator.id, "custom_title")).toBe("Boss");
    });
  });

  describe("signature", () => {
    test("needs profile.signature to set one; clearing is always allowed", async () => {
      const w = world();
      await expect(update(w, w.memberActor, { signature: "hi" })).rejects.toBeInstanceOf(
        ForbiddenError,
      );
      expect((await update(w, w.memberActor, { signature: null })).signatureHtml).toBeNull();
      await expect(update(w, GUEST, { signature: "hi" })).rejects.toBeInstanceOf(
        UnauthenticatedError,
      );
    });

    test("stores the source and the rendered html, and clears both", async () => {
      const w = world();
      const profile = await update(w, w.moderatorActor, { signature: "**bold** line" });
      expect(profile.signatureHtml).toContain("<strong>bold</strong>");
      expect(stored(w, w.moderator.id, "signature_source")).toBe("**bold** line");
      expect(String(stored(w, w.moderator.id, "signature_html"))).toContain("<strong>");
      const cleared = await update(w, w.moderatorActor, { signature: "" });
      expect(cleared.signatureHtml).toBeNull();
      expect(stored(w, w.moderator.id, "signature_source")).toBeNull();
      expect(stored(w, w.moderator.id, "signature_html")).toBeNull();
      await update(w, w.moderatorActor, { signature: "x" });
      await update(w, w.moderatorActor, { signature: null });
      expect(stored(w, w.moderator.id, "signature_source")).toBeNull();
    });

    test("the length and line limits are the site settings", async () => {
      const w = world();
      await expect(
        update(w, w.moderatorActor, { signature: "a\nb\nc\nd\ne" }),
      ).rejects.toBeInstanceOf(ValidationError);
      await w.call("settings.update", w.adminActor, { signatureMaxLines: 6 });
      await update(w, w.moderatorActor, { signature: "a\nb\nc\nd\ne" });
      await expect(
        update(w, w.moderatorActor, { signature: "x".repeat(301) }),
      ).rejects.toBeInstanceOf(ValidationError);
      await w.call("settings.update", w.adminActor, { signatureMaxLength: 400 });
      await update(w, w.moderatorActor, { signature: "x".repeat(301) });
      await w.call("settings.update", w.adminActor, { signatureMaxLength: 5 });
      await expect(update(w, w.moderatorActor, { signature: "123456" })).rejects.toBeInstanceOf(
        ValidationError,
      );
    });

    test("a signature stays stored but is not shown once the permission is lost", async () => {
      const w = world();
      await update(w, w.moderatorActor, { signature: "kept" });
      w.ctx.sqlite.run(`UPDATE users SET group_id = 2 WHERE id = ${w.moderator.id}`);
      const profile = await w.call("profiles.get", w.memberActor, { userId: w.moderator.id });
      expect(profile.signatureHtml).toBeNull();
      expect(stored(w, w.moderator.id, "signature_source")).toBe("kept");
    });
  });

  test("a guest cannot update", async () => {
    const w = world();
    await expect(update(w, GUEST, { about: "x" })).rejects.toBeInstanceOf(UnauthenticatedError);
  });
});

describe("profiles.get: the member fields", () => {
  test("a fresh member shows the empty values", async () => {
    const w = world();
    const profile = await w.call("profiles.get", w.memberActor, { userId: w.member.id });
    expect(profile).toMatchObject({
      customTitle: null,
      signatureHtml: null,
      location: "",
      website: "",
      birthday: null,
      socials: { discord: "", telegram: "", x: "" },
      followerCount: 0,
      followingCount: 0,
      credits: 0,
      awardXp: 0,
      level: { level: 1, currentLevelXp: 0, nextLevelXp: 100 },
      awardSlots: 5,
      referralCount: 0,
      lastActivityAt: null,
      viewer: { isFollowing: false, isIgnoring: false },
    });
    expect(profile.card.id).toBe(w.member.id);
  });

  test("the awardSlots value is the member's, not the viewer's", async () => {
    const w = world();
    const asAdmin = await w.call("profiles.get", w.adminActor, { userId: w.member.id });
    expect(asAdmin.awardSlots).toBe(5);
    const asMember = await w.call("profiles.get", w.memberActor, { userId: w.moderator.id });
    expect(asMember.awardSlots).toBe(6);
  });

  test("the last activity is the stored value or the newer buffered one, to the minute", async () => {
    const w = world();
    const stamp = Date.UTC(2026, 0, 1, 10, 30, 45);
    w.set(w.member.id, { last_activity_at: stamp });
    let profile = await w.call("profiles.get", w.adminActor, { userId: w.member.id });
    expect(profile.lastActivityAt).toBe("2026-01-01T10:30:00.000Z");
    w.ctx.activity.set(w.member.id, stamp + 5 * 60_000);
    profile = await w.call("profiles.get", w.adminActor, { userId: w.member.id });
    expect(profile.lastActivityAt).toBe("2026-01-01T10:35:00.000Z");
    w.ctx.activity.set(w.member.id, stamp - 60_000);
    profile = await w.call("profiles.get", w.adminActor, { userId: w.member.id });
    expect(profile.lastActivityAt).toBe("2026-01-01T10:30:00.000Z");
    const buffered = w.user();
    w.ctx.activity.set(buffered.id, stamp);
    expect(
      (await w.call("profiles.get", w.adminActor, { userId: buffered.id })).lastActivityAt,
    ).toBe("2026-01-01T10:30:00.000Z");
  });

  test("the viewer's follow and ignore are read for someone else only", async () => {
    const w = world();
    const other = w.user();
    w.ctx.sqlite.run(
      `INSERT INTO user_follows (user_id, followed_id, created_at) VALUES (${w.member.id}, ${other.id}, 0)`,
    );
    w.ctx.sqlite.run(
      `INSERT INTO user_ignores (user_id, ignored_id, created_at) VALUES (${w.member.id}, ${other.id}, 0)`,
    );
    const seen = await w.call("profiles.get", w.memberActor, { userId: other.id });
    expect(seen.viewer).toEqual({ isFollowing: true, isIgnoring: true });
    const reverse = await w.call(
      "profiles.get",
      { kind: "user", userId: other.id, groupId: 2, sessionId: 0 },
      { userId: w.member.id },
    );
    expect(reverse.viewer).toEqual({ isFollowing: false, isIgnoring: false });
    const own = await w.call("profiles.get", w.memberActor, { userId: w.member.id });
    expect(own.viewer).toEqual({ isFollowing: false, isIgnoring: false });
    const guest = await w.call("profiles.get", GUEST, { userId: other.id });
    expect(guest.viewer).toEqual({ isFollowing: false, isIgnoring: false });
  });

  test("the birthday year and the signature source are not in the public profile", async () => {
    const w = world();
    await update(w, w.moderatorActor, {
      birthday: { month: 7, day: 4, year: 1985 },
      signature: "src",
    });
    const profile = await w.call("profiles.get", w.memberActor, { userId: w.moderator.id });
    expect(JSON.stringify(profile)).not.toContain("1985");
    expect(profile).not.toHaveProperty("signatureSource");
  });
});

describe("profiles.self", () => {
  test("it needs an account", async () => {
    const w = world();
    await expect(w.call("profiles.self", GUEST, {})).rejects.toBeInstanceOf(UnauthenticatedError);
  });

  test("a member sees their source, birth year, permissions and the limits", async () => {
    const w = world();
    await update(w, w.moderatorActor, {
      birthday: { month: 7, day: 4, year: 1985 },
      signature: "src",
    });
    const self = await w.call("profiles.self", w.moderatorActor, {});
    expect(self).toMatchObject({
      signatureSource: "src",
      birthYear: 1985,
      referrerId: null,
      may: { setSignature: true, setCustomTitle: true },
      limits: { signatureMaxLength: 300, signatureMaxLines: 4, customTitleMaxLength: 40 },
    });
    expect(self.profile.id).toBe(w.moderator.id);
    const plain = await w.call("profiles.self", w.memberActor, {});
    expect(plain.may).toEqual({ setSignature: false, setCustomTitle: false });
    expect(plain.signatureSource).toBeNull();
    expect(plain.birthYear).toBeNull();
  });

  test("the limits follow the site settings", async () => {
    const w = world();
    await w.call("settings.update", w.adminActor, {
      signatureMaxLength: 99,
      customTitleMaxLength: 12,
    });
    const self = await w.call("profiles.self", w.memberActor, {});
    expect(self.limits).toMatchObject({ signatureMaxLength: 99, customTitleMaxLength: 12 });
  });

  test("a referrer can be named once, in the first seven days", async () => {
    const w = world();
    expect((await w.call("profiles.self", w.memberActor, {})).canSetReferrer).toBe(true);
    w.set(w.member.id, { referred_by: w.moderator.id });
    const named = await w.call("profiles.self", w.memberActor, {});
    expect(named).toMatchObject({ canSetReferrer: false, referrerId: w.moderator.id });
    w.set(w.member.id, { referred_by: null });
    w.ctx.clock.advance(7 * 86_400_000);
    expect((await w.call("profiles.self", w.memberActor, {})).canSetReferrer).toBe(false);
  });
});

test("the profile queries read by key", () => {
  const w = world();
  expectNoTableScan(w.ctx, PROFILE_SQL, [w.member.id]);
  expectNoTableScan(
    w.ctx,
    "SELECT 1 FROM user_follows WHERE user_id = ?1 AND followed_id = ?2",
    [1, 2],
  );
  expectNoTableScan(
    w.ctx,
    "SELECT 1 FROM user_ignores WHERE user_id = ?1 AND ignored_id = ?2",
    [1, 2],
  );
});
