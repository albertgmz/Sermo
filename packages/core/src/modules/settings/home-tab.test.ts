import { describe, expect, test } from "bun:test";
import { createTestContext, insertUser, userActor } from "@sermo/core/testing";
import { GUEST } from "../../actor";
import type { Ctx } from "../../context";
import { ForbiddenError, ValidationError } from "../../errors";
import { execute } from "../../operation";
import { getOperation } from "../../operations";
import { readSiteSettings } from "./index";

const run = (ctx: Ctx, name: string, actor: Parameters<typeof execute>[2], input: object = {}) =>
  // biome-ignore lint/suspicious/noExplicitAny: operations are called by name, their output is loosely typed
  execute(ctx, getOperation(name), actor, input) as Promise<any>;

const rule = (...conditions: object[]) => ({ match: "all", conditions });
const GUESTS = rule({ criterion: "is_guest", value: 1 });
const MEMBERS = rule({ criterion: "is_guest", value: 0 });
const OLD_HANDS = rule({ criterion: "post_count", value: 10 });

function setup() {
  const ctx = createTestContext();
  const admin = userActor(insertUser(ctx, { groupId: 4 }));
  const memberUser = insertUser(ctx);
  const member = userActor(memberUser);
  const tab = (actor: Parameters<typeof execute>[2]) =>
    run(ctx, "site.homeTab", actor).then((answer) => answer.tab);
  const save = (homeTab: object) => run(ctx, "settings.update", admin, { homeTab });
  return { ctx, admin, memberUser, member, tab, save };
}

describe("site.homeTab", () => {
  test("is latest for everyone until an administrator sets something", async () => {
    const f = setup();
    expect(await f.tab(GUEST)).toBe("latest");
    expect(await f.tab(f.member)).toBe("latest");
    expect(readSiteSettings(f.ctx).homeTab).toEqual({ rules: [], fallback: "latest" });
  });

  test("the first rule the viewer meets wins, else the fallback", async () => {
    const f = setup();
    await f.save({
      rules: [
        { rule: GUESTS, tab: "hot" },
        { rule: OLD_HANDS, tab: "forums" },
        { rule: MEMBERS, tab: "following" },
      ],
      fallback: "media",
    });
    expect(await f.tab(GUEST)).toBe("hot");
    // A member with few posts misses the second rule and meets the third.
    expect(await f.tab(f.member)).toBe("following");
    f.ctx.sqlite.prepare("UPDATE users SET post_count = 12 WHERE id = ?1").run(f.memberUser.id);
    expect(await f.tab(f.member)).toBe("forums");
  });

  test("the fallback answers a viewer no rule fits", async () => {
    const f = setup();
    await f.save({ rules: [{ rule: GUESTS, tab: "hot" }], fallback: "forums" });
    expect(await f.tab(f.member)).toBe("forums");
  });

  test("a member's own choice beats the rules and the fallback", async () => {
    const f = setup();
    await f.save({ rules: [{ rule: MEMBERS, tab: "hot" }], fallback: "forums" });
    await run(f.ctx, "preferences.update", f.member, { homeTab: "media" });
    expect(await f.tab(f.member)).toBe("media");
    await run(f.ctx, "preferences.update", f.member, { homeTab: null });
    expect(await f.tab(f.member)).toBe("hot");
  });

  test("a guest is never answered following, whatever the setting says", async () => {
    const f = setup();
    // Stored by hand: the update refuses it, but the answer must not depend on that.
    await f.save({ rules: [], fallback: "hot" });
    f.ctx.sqlite
      .prepare(
        "UPDATE site_settings SET value = json_set(value, '$.homeTab', json('{\"rules\":[],\"fallback\":\"following\"}')) WHERE key = 'configuration'",
      )
      .run();
    expect(await f.tab(GUEST)).toBe("latest");
    expect(await f.tab(f.member)).toBe("following");
  });
});

describe("the home tab setting", () => {
  test("is replaced as a whole, and only by someone who may change settings", async () => {
    const f = setup();
    await expect(
      run(f.ctx, "settings.update", f.member, {
        homeTab: { rules: [], fallback: "hot" },
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const saved = await f.save({ rules: [{ rule: MEMBERS, tab: "hot" }], fallback: "forums" });
    expect(saved.homeTab).toEqual({
      rules: [{ rule: MEMBERS, tab: "hot" }],
      fallback: "forums",
    });
    // An update that does not name it leaves it alone.
    await run(f.ctx, "settings.update", f.admin, { siteName: "Other" });
    expect(readSiteSettings(f.ctx).homeTab.fallback).toBe("forums");
  });

  test("refuses a rule that is too heavy to read on every home page", async () => {
    const f = setup();
    await expect(
      f.save({
        rules: [{ rule: rule({ criterion: "warning_points_below", value: 3 }), tab: "hot" }],
        fallback: "latest",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test("refuses following for a rule a guest can meet, and as the fallback", async () => {
    const f = setup();
    for (const guestRule of [rule(), GUESTS, rule({ criterion: "not_in_group", ids: [4] })])
      await expect(
        f.save({ rules: [{ rule: guestRule, tab: "following" }], fallback: "latest" }),
      ).rejects.toBeInstanceOf(ValidationError);
    await expect(f.save({ rules: [], fallback: "following" })).rejects.toBeInstanceOf(
      ValidationError,
    );
    // A rule that needs an account may pick it.
    const ok = await f.save({
      rules: [{ rule: MEMBERS, tab: "following" }],
      fallback: "latest",
    });
    expect(ok.homeTab.rules[0]?.tab).toBe("following");
  });

  test("refuses an unknown tab, too many rules and a criterion that does not exist", async () => {
    const f = setup();
    await expect(f.save({ rules: [], fallback: "top" })).rejects.toBeInstanceOf(ValidationError);
    await expect(
      f.save({ rules: [{ rule: MEMBERS, tab: "photos" }], fallback: "latest" }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      f.save({
        rules: Array.from({ length: 11 }, () => ({ rule: MEMBERS, tab: "hot" })),
        fallback: "latest",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      f.save({
        rules: [{ rule: rule({ criterion: "nonsense", value: 1 }), tab: "hot" }],
        fallback: "latest",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
