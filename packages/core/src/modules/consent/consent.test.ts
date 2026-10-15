import { afterEach, describe, expect, test } from "bun:test";
import { createTestContext, insertUser, userActor } from "@sermo/core/testing";
import { type Actor, GUEST } from "../../actor";
import type { Ctx } from "../../context";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthenticatedError,
  ValidationError,
} from "../../errors";
import { execute } from "../../operation";
import { getOperation } from "../../operations";
import { resolvedActor, sharedDatabase } from "../../permissions/test-contexts";
import { accounts, closeAll, PASSWORD } from "../admin/fixtures.test";
import { readSiteSettings } from "../settings";
import { CONSENT_REGION_COUNTRIES, inConsentRegion } from "./regions";

afterEach(closeAll);

// biome-ignore lint/suspicious/noExplicitAny: operations are called by name, their output is loosely typed
const run = (ctx: Ctx, name: string, actor: Actor, input: object = {}): Promise<any> =>
  execute(ctx, getOperation(name), actor, input);

function setup() {
  const ctx = createTestContext();
  const admin = userActor(insertUser(ctx, { groupId: 4 }));
  const memberUser = insertUser(ctx);
  const member = userActor(memberUser);
  const version = () => readSiteSettings(ctx).cookiePolicyVersion;
  const save = (categories: string[], policyVersion = version(), actor: Actor = member) =>
    run(ctx, "consent.save", actor, { categories, policyVersion });
  return { ctx, admin, member, memberUser, version, save };
}

const records = (ctx: Ctx) =>
  ctx.sqlite.prepare<{ n: number }, []>("SELECT count(*) AS n FROM consent_records").get()?.n;

describe("consent.save and consent.mine", () => {
  test("a member has no record until they save one", async () => {
    const f = setup();
    expect(await run(f.ctx, "consent.mine", f.member)).toEqual({ record: null });
  });

  test("saves the categories, the policy version and the time of the call", async () => {
    const f = setup();
    const saved = await f.save(["embeds", "analytics"]);
    expect(saved.record).toEqual({
      categories: ["analytics", "embeds"],
      policyVersion: 1,
      decidedAt: new Date(f.ctx.now()).toISOString(),
    });
    expect(await run(f.ctx, "consent.mine", f.member)).toEqual({ record: saved.record });
  });

  test("refusing everything is a record too, and a later choice replaces the earlier one", async () => {
    const f = setup();
    expect((await f.save([])).record.categories).toEqual([]);
    expect((await run(f.ctx, "consent.mine", f.member)).record.categories).toEqual([]);
    await f.save(["referrals"]);
    expect((await run(f.ctx, "consent.mine", f.member)).record.categories).toEqual(["referrals"]);
    expect(records(f.ctx)).toBe(1);
  });

  test("withdrawing a category updates the record", async () => {
    const f = setup();
    await f.save(["analytics", "referrals", "embeds"]);
    await f.save(["referrals"]);
    expect((await run(f.ctx, "consent.mine", f.member)).record.categories).toEqual(["referrals"]);
  });

  test("each member has their own record", async () => {
    const f = setup();
    const other = userActor(insertUser(f.ctx));
    await f.save(["analytics"]);
    expect((await run(f.ctx, "consent.mine", other)).record).toBeNull();
  });

  test("guests cannot save or read one", async () => {
    const f = setup();
    await expect(f.save([], 1, GUEST)).rejects.toBeInstanceOf(UnauthenticatedError);
    await expect(run(f.ctx, "consent.mine", GUEST)).rejects.toBeInstanceOf(UnauthenticatedError);
  });

  test("refuses a category that does not exist and a category named twice", async () => {
    const f = setup();
    await expect(f.save(["necessary"])).rejects.toBeInstanceOf(ValidationError);
    await expect(f.save(["analytics", "analytics"])).rejects.toBeInstanceOf(ValidationError);
    expect(records(f.ctx)).toBe(0);
  });
});

describe("the policy version", () => {
  test("starts at 1 and the site carries it", async () => {
    const f = setup();
    expect((await run(f.ctx, "site.get", GUEST)).cookiePolicyVersion).toBe(1);
  });

  test("a choice answering another version than the site has is a conflict and saves nothing", async () => {
    const f = setup();
    await expect(f.save(["analytics"], 2)).rejects.toBeInstanceOf(ConflictError);
    await run(f.ctx, "consent.askAgain", f.admin);
    await expect(f.save(["analytics"], 1)).rejects.toBeInstanceOf(ConflictError);
    expect((await run(f.ctx, "consent.mine", f.member)).record).toBeNull();
  });

  test("asking everyone again raises it by one and keeps the old record, now older than the site version", async () => {
    const f = setup();
    await f.save(["analytics"]);
    expect(await run(f.ctx, "consent.askAgain", f.admin)).toEqual({ policyVersion: 2 });
    expect((await run(f.ctx, "site.get", GUEST)).cookiePolicyVersion).toBe(2);
    const { record } = await run(f.ctx, "consent.mine", f.member);
    expect(record.policyVersion).toBe(1);
    expect(record.policyVersion).toBeLessThan(f.version());
    // The member answers the new text.
    expect((await f.save(["analytics"], 2)).record.policyVersion).toBe(2);
  });

  test("settings.update changes every other key but never the version", async () => {
    const f = setup();
    await run(f.ctx, "settings.update", f.admin, { cookiePolicyVersion: 9, siteName: "Club" });
    expect(f.version()).toBe(1);
    expect(readSiteSettings(f.ctx).siteName).toBe("Club");
    expect((await run(f.ctx, "settings.get", f.admin)).cookiePolicyVersion).toBe(1);
  });

  test("is logged, and refused to members and guests", async () => {
    const f = setup();
    await expect(run(f.ctx, "consent.askAgain", f.member)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(run(f.ctx, "consent.askAgain", GUEST)).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
    expect(f.version()).toBe(1);
    await run(f.ctx, "consent.askAgain", f.admin);
    const entry = f.ctx.sqlite
      .prepare<{ action: string; details: string }, []>(
        "SELECT action, details FROM moderator_log ORDER BY id DESC LIMIT 1",
      )
      .get();
    expect(entry?.action).toBe("settings.update");
    expect(JSON.parse(entry?.details ?? "{}")).toEqual({ changedKeys: ["cookiePolicyVersion"] });
  });

  test("an administrator revoked in another process cannot raise it", async () => {
    const fixture = createTestContext();
    const founder = userActor(insertUser(fixture, { groupId: 4 }));
    const group = await run(fixture, "groups.create", founder, { title: "Editors", rank: 40 });
    await run(fixture, "permissions.set", founder, {
      groupId: group.id,
      entries: [{ permission: "admin.settings", value: "allow" }],
    });
    const staff = insertUser(fixture, { groupId: group.id });
    const database = sharedDatabase(fixture);
    const here = database.open();
    const elsewhere = database.open();
    try {
      const actor = resolvedActor(here, staff.id);
      await run(elsewhere, "users.setGroups", founder, { userId: staff.id, primaryGroupId: 2 });
      await expect(run(here, "consent.askAgain", actor)).rejects.toBeInstanceOf(ForbiddenError);
      expect(readSiteSettings(here).cookiePolicyVersion).toBe(1);
    } finally {
      database.close();
    }
  });
});

describe("the banner settings", () => {
  test("default: banner for everyone, Matomo with cookies", async () => {
    const f = setup();
    const site = await run(f.ctx, "site.get", GUEST);
    expect(site).toMatchObject({ cookieBannerOutsideEu: true, matomoCookieless: false });
  });

  test("an administrator changes them and the site carries them", async () => {
    const f = setup();
    await run(f.ctx, "settings.update", f.admin, {
      matomoCookieless: true,
      cookieBannerOutsideEu: false,
    });
    expect(await run(f.ctx, "site.get", GUEST)).toMatchObject({
      matomoCookieless: true,
      cookieBannerOutsideEu: false,
    });
  });

  test("members cannot change them", async () => {
    const f = setup();
    await expect(
      run(f.ctx, "settings.update", f.member, { matomoCookieless: true }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("consent.banner", () => {
  const at = (country: string | null): Actor =>
    Object.freeze({
      kind: "guest" as const,
      ...(country ? { clientLocation: { country, region: null, city: null } } : {}),
    });
  const show = (f: ReturnType<typeof setup>, actor: Actor) =>
    run(f.ctx, "consent.banner", actor).then((answer) => answer.show);

  test("is shown to everyone while the site shows it everywhere", async () => {
    const f = setup();
    expect(await show(f, GUEST)).toBe(true);
    expect(await show(f, at("US"))).toBe(true);
  });

  test("outside the EU only: shown in Europe and where the country is not known, hidden elsewhere", async () => {
    const f = setup();
    await run(f.ctx, "settings.update", f.admin, { cookieBannerOutsideEu: false });
    expect(await show(f, GUEST)).toBe(true);
    expect(await show(f, at(null))).toBe(true);
    for (const code of ["ES", "DE", "GB", "CH", "NO"]) expect(await show(f, at(code))).toBe(true);
    expect(await show(f, at("US"))).toBe(false);
    expect(await show(f, at("JP"))).toBe(false);
  });

  test("a signed-in member is placed by the same trusted location", async () => {
    const f = setup();
    await run(f.ctx, "settings.update", f.admin, { cookieBannerOutsideEu: false });
    const signedIn = userActor(f.memberUser) as Extract<Actor, { kind: "user" }>;
    const located = (country: string): Actor => ({
      ...signedIn,
      clientLocation: { country, region: null, city: null },
    });
    expect(await show(f, located("BR"))).toBe(false);
    expect(await show(f, located("FR"))).toBe(true);
  });

  test("the list holds the 27 EU members, Iceland, Liechtenstein, Norway, the UK and Switzerland", () => {
    expect(CONSENT_REGION_COUNTRIES.size).toBe(32);
    for (const code of ["ES", "IE", "GR", "SE", "IS", "LI", "NO", "GB", "CH"])
      expect(inConsentRegion(code)).toBe(true);
    for (const code of ["US", "CA", "TR", "RU", "UA", "XX"])
      expect(inConsentRegion(code)).toBe(false);
    expect(inConsentRegion("es")).toBe(true);
  });
});

describe("users.consent (staff)", () => {
  test("an administrator reads a member's record", async () => {
    const f = setup();
    await f.save(["referrals", "embeds"]);
    const { record } = await run(f.ctx, "users.consent", f.admin, { userId: f.memberUser.id });
    expect(record).toMatchObject({ categories: ["referrals", "embeds"], policyVersion: 1 });
    const none = await run(f.ctx, "users.consent", f.admin, { userId: insertUser(f.ctx).id });
    expect(none.record).toBeNull();
  });

  test("members and guests may not, and an unknown member is not found", async () => {
    const f = setup();
    await f.save(["analytics"]);
    const other = userActor(insertUser(f.ctx));
    await expect(
      run(f.ctx, "users.consent", other, { userId: f.memberUser.id }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    // Not even their own record, through the staff read.
    await expect(
      run(f.ctx, "users.consent", f.member, { userId: f.memberUser.id }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      run(f.ctx, "users.consent", GUEST, { userId: f.memberUser.id }),
    ).rejects.toBeInstanceOf(UnauthenticatedError);
    await expect(run(f.ctx, "users.consent", f.admin, { userId: 999_999 })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  test("an administrator cannot read the record of a member who ranks as high as they do", async () => {
    const f = setup();
    const peer = insertUser(f.ctx, { groupId: 4 });
    await expect(run(f.ctx, "users.consent", f.admin, { userId: peer.id })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });
});

describe("erasing a member", () => {
  test("removes their record and leaves everyone else's", async () => {
    const w = await accounts();
    const founder = await w.register("Founder", 4);
    const target = await w.register("Target");
    const other = await w.register("Other");
    const choose = (actor: object) =>
      w.run("consent.save", actor, { categories: ["analytics"], policyVersion: 1 });
    await choose(target.actor);
    await choose(other.actor);
    await w.run("users.adminErase", founder.actor, {
      userId: target.id,
      actorPassword: PASSWORD,
      reason: "Right to be forgotten",
    });
    const left = w.ctx.sqlite
      .prepare<{ user_id: number }, []>("SELECT user_id FROM consent_records")
      .all()
      .map((row) => row.user_id);
    expect(left).toEqual([other.id]);
  });

  test("a request resolved before the erasure cannot bring the record back", async () => {
    const w = await accounts();
    const founder = await w.register("Founder", 4);
    const target = await w.register("Target");
    await w.run("users.adminErase", founder.actor, {
      userId: target.id,
      actorPassword: PASSWORD,
      reason: "Right to be forgotten",
    });
    await expect(
      w.run("consent.save", target.actor, { categories: ["analytics"], policyVersion: 1 }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(w.ctx.sqlite.prepare("SELECT count(*) AS n FROM consent_records").get()).toEqual({
      n: 0,
    });
  });
});
