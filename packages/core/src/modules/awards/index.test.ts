import { afterEach, describe, expect, test } from "bun:test";
import { createTestContext, insertUser, tokenActor, userActor } from "@sermo/core/testing";
import { GUEST } from "../../actor";
import { closeContext, invalidate } from "../../context";
import { writeTx } from "../../db/tx";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthenticatedError,
  ValidationError,
} from "../../errors";
import { execute } from "../../operation";
import { getOperation } from "../../operations";
import { moveCredits } from "../../shared/credits";
import { criterionDefinitions } from "../../shared/criteria";
import { withTitles } from "../../shared/language";
import { readSiteSettings, storeSiteSettings } from "../settings";

const contexts: ReturnType<typeof createTestContext>[] = [];
afterEach(() => {
  for (const ctx of contexts.splice(0)) closeContext(ctx);
});
function setup() {
  const ctx = createTestContext();
  storeSiteSettings(ctx, { ...readSiteSettings(ctx), defaultLanguage: "en" });
  contexts.push(ctx);
  const admin = userActor(insertUser(ctx, { groupId: 4 }));
  const member = insertUser(ctx);
  const call = (name: string, input: unknown = {}) =>
    execute(ctx, getOperation(`awards.${name}`), admin, input);
  return { ctx, admin, member, call };
}
function counters(ctx: ReturnType<typeof createTestContext>, userId: number, awardId: number) {
  return ctx.sqlite
    .prepare(
      "SELECT u.award_xp, u.credits, a.grant_count, t.count, t.auto_granted FROM users u JOIN member_award_totals t ON t.user_id = u.id JOIN awards a ON a.id = t.award_id WHERE u.id = ?1 AND a.id = ?2",
    )
    .get(userId, awardId);
}

describe("award icons", () => {
  test("an award takes no icon or a key of the site's icon set, and refuses any other", async () => {
    const { call } = setup();
    const plain = await call("create", { name: "Plain", tier: "bronze" });
    expect(plain.icon).toBe("");
    const keyed = await call("create", { name: "Keyed", tier: "bronze", icon: "shield-check" });
    expect(keyed.icon).toBe("shield-check");
    expect((await call("update", { awardId: keyed.id, icon: "gem" })).icon).toBe("gem");
    expect((await call("update", { awardId: keyed.id, icon: "" })).icon).toBe("");
    for (const icon of ["nonsense", "Shield", "shield check", "https://example.test/a.png"]) {
      const refused = await call("create", { name: "Refused", tier: "bronze", icon }).catch(
        (error) => error,
      );
      expect(refused, icon).toBeInstanceOf(ValidationError);
      expect((refused as ValidationError).issues?.[0]?.path).toEqual(["icon"]);
      await expect(call("update", { awardId: keyed.id, icon }), icon).rejects.toBeInstanceOf(
        ValidationError,
      );
    }
    // Not the same text twice: a missing award is a 404 before the icon is looked at.
    await expect(call("update", { awardId: 9999, icon: "nonsense" })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    // A refused change leaves the award as it was.
    expect((await call("get", { awardId: keyed.id })).icon).toBe("");
    // An update that leaves the icon out keeps whatever is stored.
    await call("update", { awardId: keyed.id, icon: "crown" });
    expect((await call("update", { awardId: keyed.id, name: "Renamed" })).icon).toBe("crown");
  });
});

describe("award icons made before the key was checked", () => {
  test("an award with free text as its icon can be edited, and the text only sent back is kept", async () => {
    const { ctx, call } = setup();
    const award = await call("create", { name: "Old", tier: "bronze" });
    ctx.sqlite.prepare("UPDATE awards SET icon = 'fa-trophy' WHERE id = ?1").run(award.id);
    const edited = await call("update", {
      awardId: award.id,
      icon: "fa-trophy",
      xp: 9,
      name: "New",
    });
    expect(edited).toMatchObject({ icon: "fa-trophy", xp: 9, name: "New" });
    expect((await call("update", { awardId: award.id, xp: 3 })).icon).toBe("fa-trophy");
    // Changing it to other text is still refused; a key or nothing is taken.
    await expect(call("update", { awardId: award.id, icon: "other-text" })).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect((await call("update", { awardId: award.id, icon: "heart" })).icon).toBe("heart");
  });
});

describe("award grants", () => {
  test("a second non-stackable grant conflicts without changing any counter or ledger", async () => {
    const { ctx, member, call } = setup();
    const award = await call("create", { name: "First", tier: "bronze", xp: 7, credits: 11 });
    const input = { userId: member.id, awardId: award.id, reason: "Earned" };
    const grant = await call("grant", input);
    expect(grant.reason).toBe("Earned");
    expect(grant.award.grantCount).toBe(1);
    await expect(call("grant", input)).rejects.toBeInstanceOf(ConflictError);
    expect(counters(ctx, member.id, award.id)).toEqual({
      award_xp: 7,
      credits: 11,
      grant_count: 1,
      count: 1,
      auto_granted: 0,
    });
    expect(
      ctx.sqlite
        .prepare(
          "SELECT amount, type, source_type, source_id FROM credit_transactions WHERE user_id = ?1",
        )
        .all(member.id),
    ).toEqual([{ amount: 11, type: "award", source_type: "member_award", source_id: grant.id }]);
  });

  test("revoking the middle of three stacked grants removes exactly its contribution", async () => {
    const { ctx, member, call } = setup();
    const award = await call("create", {
      name: "Stack",
      tier: "gold",
      xp: 7,
      credits: 11,
      isStackable: true,
    });
    const grants = [];
    for (let i = 0; i < 3; i++)
      grants.push(await call("grant", { userId: member.id, awardId: award.id }));
    await expect(call("update", { awardId: award.id, isStackable: false })).rejects.toBeInstanceOf(
      ConflictError,
    );
    await call("revoke", { memberAwardId: grants[1]!.id });
    expect(counters(ctx, member.id, award.id)).toEqual({
      award_xp: 14,
      credits: 22,
      grant_count: 2,
      count: 2,
      auto_granted: 0,
    });
    expect(
      (await call("memberGrants", { userId: member.id })).items.map((g: { id: number }) => g.id),
    ).toEqual([grants[2]!.id, grants[0]!.id]);
    await expect(call("revoke", { memberAwardId: grants[1]!.id })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  test("revocation uses original XP and credits even after the award changes", async () => {
    const { ctx, member, call } = setup();
    const award = await call("create", { name: "Original", tier: "silver", xp: 7, credits: 11 });
    const grant = await call("grant", { userId: member.id, awardId: award.id });
    await call("update", { awardId: award.id, xp: 80, credits: 90, isActive: false });
    await call("revoke", { memberAwardId: grant.id });
    expect(counters(ctx, member.id, award.id)).toEqual({
      award_xp: 0,
      credits: 0,
      grant_count: 0,
      count: 0,
      auto_granted: 0,
    });
    await expect(call("delete", { awardId: award.id })).rejects.toBeInstanceOf(ConflictError);
  });

  test("revoking after spending credits can make the balance negative and publishes stored values", async () => {
    const { ctx, admin, member, call } = setup();
    const award = await call("create", { name: "Spent", tier: "bronze", xp: 4, credits: 20 });
    const grant = await call("grant", { userId: member.id, awardId: award.id, reason: "Welcome" });
    writeTx(ctx, () => moveCredits(ctx, [{ userId: member.id, amount: -20, type: "adjustment" }]));
    await call("revoke", { memberAwardId: grant.id, reason: "Correction" });
    expect(counters(ctx, member.id, award.id)).toEqual({
      award_xp: 0,
      credits: -20,
      grant_count: 0,
      count: 0,
      auto_granted: 0,
    });
    const events = ctx.sqlite
      .prepare<{ type: string; payload: string }, []>(
        "SELECT type, payload FROM domain_events WHERE type IN ('award.granted', 'award.revoked') ORDER BY id",
      )
      .all();
    expect(
      events.map((event) => ({ type: event.type, payload: JSON.parse(event.payload) })),
    ).toEqual([
      {
        type: "award.granted",
        payload: {
          memberAwardId: grant.id,
          awardId: award.id,
          xp: 4,
          credits: 20,
          actorId: admin.kind === "guest" ? null : admin.userId,
          reason: "Welcome",
        },
      },
      {
        type: "award.revoked",
        payload: {
          memberAwardId: grant.id,
          awardId: award.id,
          xp: 4,
          credits: 20,
          actorId: admin.kind === "guest" ? null : admin.userId,
          reason: "Correction",
        },
      },
    ]);
    expect(
      ctx.sqlite
        .prepare("SELECT revoked_at, revoked_by FROM member_awards WHERE id = ?1")
        .get(grant.id),
    ).toEqual({ revoked_at: ctx.now(), revoked_by: admin.kind === "guest" ? null : admin.userId });
  });

  test("a failed credit movement rolls back the totals claim, grant, counters and events", async () => {
    const { ctx, member, call } = setup();
    writeTx(ctx, () =>
      moveCredits(ctx, [
        { userId: member.id, amount: Number.MAX_SAFE_INTEGER, type: "adjustment" },
      ]),
    );
    const award = await call("create", { name: "Overflow", tier: "bronze", xp: 4, credits: 1 });
    await expect(call("grant", { userId: member.id, awardId: award.id })).rejects.toBeInstanceOf(
      ConflictError,
    );
    expect(counters(ctx, member.id, award.id)).toBeNull();
    expect(await call("member", { userId: member.id })).toEqual({ xp: 0, items: [] });
    expect((await call("get", { awardId: award.id })).grantCount).toBe(0);
    expect(ctx.sqlite.prepare("SELECT id FROM member_awards").all()).toEqual([]);
    expect(
      ctx.sqlite.prepare("SELECT id FROM domain_events WHERE type = 'award.granted'").all(),
    ).toEqual([]);
  });

  test("concurrent requests get exactly one non-stackable grant; manual regrant after revoke is allowed", async () => {
    const { ctx, member, call } = setup();
    const award = await call("create", { name: "Once held", tier: "bronze", xp: 2, credits: 3 });
    const input = { userId: member.id, awardId: award.id };
    const results = await Promise.allSettled([call("grant", input), call("grant", input)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const failed = results.find((result) => result.status === "rejected");
    expect(failed?.status === "rejected" && failed.reason).toBeInstanceOf(ConflictError);
    const grant = (await call("memberGrants", { userId: member.id })).items[0];
    await call("revoke", { memberAwardId: grant.id });
    const next = await call("grant", input);
    expect(next.id).toBeGreaterThan(grant.id);
    expect(counters(ctx, member.id, award.id)).toEqual({
      award_xp: 2,
      credits: 3,
      grant_count: 1,
      count: 1,
      auto_granted: 0,
    });
  });
});

describe("award catalog and reads", () => {
  test("member awards sort by tier, XP and id, the catalog by XP; inactive grants remain held", async () => {
    const { ctx, member, call } = setup();
    const awards = [];
    for (const [tier, xp] of [
      ["bronze", 900],
      ["gold", 2],
      ["legendary", 0],
      ["silver", 200],
      ["gold", 9],
      ["gold", 9],
    ] as const) {
      const award = await call("create", { name: tier, tier, xp });
      awards.push(award);
      await call("grant", { userId: member.id, awardId: award.id });
    }
    const expected = [
      awards[2].id,
      awards[4].id,
      awards[5].id,
      awards[1].id,
      awards[3].id,
      awards[0].id,
    ];
    // Without categories or thresholds the catalog is easiest first: XP ascending, then name, then id.
    const catalog = [
      awards[2].id,
      awards[1].id,
      awards[4].id,
      awards[5].id,
      awards[3].id,
      awards[0].id,
    ];
    expect((await call("list")).items.map((award: { id: number }) => award.id)).toEqual(catalog);
    await call("update", { awardId: awards[2].id, isActive: false });
    const held = await call("member", { userId: member.id });
    expect(held.items.map((item: { award: { id: number } }) => item.award.id)).toEqual(expected);
    expect(held.xp).toBe(1120);
    expect(held.items[0].award.isActive).toBe(false);
    const guestList = await execute(ctx, getOperation("awards.list"), GUEST, {});
    expect(guestList.items.map((award: { id: number }) => award.id)).toEqual(catalog.slice(1));
    for (const actor of [GUEST, userActor(member), userActor(insertUser(ctx, { groupId: 3 }))]) {
      for (const name of ["get", "holders"])
        await expect(
          execute(ctx, getOperation(`awards.${name}`), actor, { awardId: awards[2].id }),
        ).rejects.toBeInstanceOf(NotFoundError);
    }
    expect((await call("get", { awardId: awards[2].id })).id).toBe(awards[2].id);
    expect((await call("holders", { awardId: awards[2].id })).items).toHaveLength(1);
  });

  test("both grant listings paginate newest first across ties and skip revoked grants", async () => {
    const { member, call } = setup();
    const award = await call("create", { name: "Pages", tier: "bronze", isStackable: true });
    const ids: number[] = [];
    for (let i = 0; i < 5; i++)
      ids.push((await call("grant", { userId: member.id, awardId: award.id })).id);
    await call("revoke", { memberAwardId: ids[2] });
    for (const [name, input] of [
      ["holders", { awardId: award.id }],
      ["memberGrants", { userId: member.id }],
    ] as const) {
      const first = await call(name, { ...input, limit: 2 });
      const second = await call(name, { ...input, limit: 2, cursor: first.nextCursor });
      expect(first.items.map((item: { id: number }) => item.id)).toEqual([ids[4], ids[3]]);
      expect(first.nextCursor).toBeString();
      expect(second.items.map((item: { id: number }) => item.id)).toEqual([ids[1], ids[0]]);
      expect(second.nextCursor).toBeNull();
      await expect(call(name, { ...input, cursor: "invalid" })).rejects.toBeInstanceOf(
        ValidationError,
      );
    }
  });

  test("updates retain omitted fields, validate criteria, allow clearing stacking after revokes and delete unused awards", async () => {
    const { ctx, member, call } = setup();
    const award = await call("create", {
      name: "  Award  ",
      tier: "gold",
      isStackable: true,
      icon: "star",
      description: "description",
    });
    expect(award.name).toBe("Award");
    const first = await call("grant", { userId: member.id, awardId: award.id });
    const second = await call("grant", { userId: member.id, awardId: award.id });
    await call("revoke", { memberAwardId: first.id });
    ctx.clock.advance(1);
    const updated = await call("update", {
      awardId: award.id,
      isStackable: false,
      name: "Updated",
      description: "",
      icon: "",
      xp: 0,
      credits: 0,
      rule: { match: "all", conditions: [{ criterion: "has_avatar", value: 0 }] },
    });
    expect(updated).toMatchObject({
      name: "Updated",
      tier: "gold",
      isStackable: false,
      description: "",
      icon: "",
      createdAt: award.createdAt,
      updatedAt: new Date(ctx.now()).toISOString(),
    });
    await expect(call("delete", { awardId: award.id })).rejects.toBeInstanceOf(ConflictError);
    await call("revoke", { memberAwardId: second.id });
    const unused = await call("create", { name: "Unused", tier: "bronze" });
    expect(await call("delete", { awardId: unused.id })).toEqual({ ok: true });
    await expect(call("get", { awardId: unused.id })).rejects.toBeInstanceOf(NotFoundError);
    for (const conditions of [
      [{ criterion: "missing", value: 0 }],
      [{ criterion: "has_avatar", value: 2 }],
      [{ criterion: "email_verified", value: 2 }],
      [{ criterion: "post_count" }],
      [{ criterion: "in_group", ids: [9999] }],
    ]) {
      const rule = { match: "all", conditions };
      await expect(
        call("create", { name: "Invalid", tier: "bronze", rule }),
      ).rejects.toBeInstanceOf(ValidationError);
      await expect(call("update", { awardId: award.id, rule })).rejects.toBeInstanceOf(
        ValidationError,
      );
    }
    expect(await call("criteria")).toEqual({ items: withTitles("en", criterionDefinitions) });
    expect(await call("run")).toEqual({ queued: true });
    expect(await call("run")).toEqual({ queued: false });
    expect(
      ctx.sqlite
        .prepare("SELECT type, payload, unique_key FROM jobs WHERE type = 'awards.sweep'")
        .all(),
    ).toEqual([{ type: "awards.sweep", payload: '{"after":0}', unique_key: "awards.sweep" }]);
  });

  test("missing targets and inactive manual grants return the specified errors", async () => {
    const { member, call } = setup();
    const award = await call("create", { name: "Inactive", tier: "bronze", isActive: false });
    await expect(call("grant", { awardId: award.id, userId: member.id })).rejects.toBeInstanceOf(
      ConflictError,
    );
    await call("update", { awardId: award.id, isActive: true });
    for (const [name, input] of [
      ["get", { awardId: 99999 }],
      ["holders", { awardId: 99999 }],
      ["update", { awardId: 99999 }],
      ["delete", { awardId: 99999 }],
      ["grant", { awardId: 99999, userId: member.id }],
      ["grant", { awardId: award.id, userId: 99999 }],
      ["revoke", { memberAwardId: 99999 }],
      ["member", { userId: 99999 }],
      ["memberGrants", { userId: 99999 }],
    ] as const)
      await expect(call(name, input)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("inactive award grants", () => {
  for (const role of ["moderator", "admin"] as const) {
    test(`granting an inactive award as ${role} is ${role === "admin" ? "a conflict" : "not found"}`, async () => {
      const { ctx, member, call } = setup();
      const award = await call("create", { name: "Hidden", tier: "bronze", isActive: false });
      const actor = userActor(insertUser(ctx, { groupId: role === "admin" ? 4 : 3 }));
      await expect(
        execute(ctx, getOperation("awards.grant"), actor, { awardId: award.id, userId: member.id }),
      ).rejects.toBeInstanceOf(role === "admin" ? ConflictError : NotFoundError);
      expect(ctx.sqlite.prepare("SELECT id FROM member_awards").all()).toEqual([]);
      expect(ctx.sqlite.prepare("SELECT id FROM member_award_totals").all()).toEqual([]);
    });
  }
});

describe("award permissions", () => {
  for (const role of ["guest", "member", "owner", "moderator", "admin", "token"] as const) {
    test(`every operation enforces its permissions for ${role}`, async () => {
      const { ctx, member, call } = setup();
      const actor =
        role === "guest"
          ? GUEST
          : role === "owner"
            ? userActor(member)
            : role === "token"
              ? tokenActor(insertUser(ctx, { groupId: 4 }))
              : userActor(
                  insertUser(ctx, { groupId: role === "admin" ? 4 : role === "moderator" ? 3 : 2 }),
                );
      const award = await call("create", { name: "Fixture", tier: "gold", isStackable: true });
      const unused = await call("create", { name: "Unused", tier: "bronze" });
      const grant = await call("grant", { awardId: award.id, userId: member.id });
      for (const [name, input, permission] of [
        ["list", {}, "view"],
        ["get", { awardId: award.id }, "view"],
        ["holders", { awardId: award.id }, "view"],
        ["member", { userId: member.id }, "view"],
        ["memberGrants", { userId: member.id }, "view"],
        ["criteria", {}, "admin"],
        ["create", { name: "New", tier: "silver" }, "admin"],
        ["update", { awardId: award.id, name: "Changed" }, "admin"],
        ["delete", { awardId: unused.id }, "admin"],
        ["run", {}, "admin"],
        ["grant", { awardId: award.id, userId: member.id }, "grant"],
        ["revoke", { memberAwardId: grant.id }, "grant"],
      ] as const) {
        const allowed =
          permission === "view" ||
          role === "admin" ||
          role === "token" ||
          (permission === "grant" && role === "moderator");
        const result = execute(ctx, getOperation(`awards.${name}`), actor, input);
        if (allowed) expect(await result).toBeDefined();
        else
          await expect(result).rejects.toBeInstanceOf(
            role === "guest" ? UnauthenticatedError : ForbiddenError,
          );
      }
    });
  }

  test("member reads enforce profile privacy, ownership, follow direction and staff bypass", async () => {
    const { ctx, member, call } = setup();
    const viewer = insertUser(ctx);
    const moderator = userActor(insertUser(ctx, { groupId: 3 }));
    const award = await call("create", { name: "Private", tier: "bronze" });
    await call("grant", { awardId: award.id, userId: member.id });
    for (const mode of ["everyone", "members", "followed", "self"]) {
      ctx.sqlite
        .prepare("UPDATE users SET profile_view_privacy = ?1 WHERE id = ?2")
        .run(mode, member.id);
      for (const name of ["member", "memberGrants"]) {
        const op = getOperation(`awards.${name}`);
        expect(await execute(ctx, op, userActor(member), { userId: member.id })).toBeDefined();
        expect(await execute(ctx, op, moderator, { userId: member.id })).toBeDefined();
        const guest = execute(ctx, op, GUEST, { userId: member.id });
        if (mode === "everyone") expect(await guest).toBeDefined();
        else await expect(guest).rejects.toBeInstanceOf(NotFoundError);
        const other = execute(ctx, op, userActor(viewer), { userId: member.id });
        if (mode === "everyone" || mode === "members") expect(await other).toBeDefined();
        else await expect(other).rejects.toBeInstanceOf(NotFoundError);
      }
    }
    ctx.sqlite
      .prepare("UPDATE users SET profile_view_privacy = 'followed' WHERE id = ?1")
      .run(member.id);
    ctx.sqlite
      .prepare("INSERT INTO user_follows (user_id, followed_id, created_at) VALUES (?1, ?2, ?3)")
      .run(viewer.id, member.id, ctx.now());
    for (const name of ["member", "memberGrants"])
      await expect(
        execute(ctx, getOperation(`awards.${name}`), userActor(viewer), { userId: member.id }),
      ).rejects.toBeInstanceOf(NotFoundError);
    ctx.sqlite
      .prepare("INSERT INTO user_follows (user_id, followed_id, created_at) VALUES (?1, ?2, ?3)")
      .run(member.id, viewer.id, ctx.now());
    for (const name of ["member", "memberGrants"])
      expect(
        await execute(ctx, getOperation(`awards.${name}`), userActor(viewer), {
          userId: member.id,
        }),
      ).toBeDefined();
  });

  test("explicit denies override staff defaults, including profile visibility", async () => {
    const { ctx, admin, member, call } = setup();
    const award = await call("create", { name: "Deny", tier: "bronze" });
    const grant = await call("grant", { userId: member.id, awardId: award.id });
    for (const key of ["profile.view", "admin.awards", "award.grant"])
      ctx.sqlite
        .prepare(
          "INSERT INTO permission_entries (permission_id, node_id, group_id, user_id, value) VALUES ((SELECT id FROM permission_definitions WHERE key = ?1), 0, 4, 0, -1) ON CONFLICT (group_id, user_id, node_id, permission_id) DO UPDATE SET value = excluded.value",
        )
        .run(key);
    invalidate(ctx, "permissions");
    for (const [name, input] of [
      ["list", {}],
      ["get", { awardId: award.id }],
      ["holders", { awardId: award.id }],
      ["criteria", {}],
      ["create", { name: "Denied", tier: "bronze" }],
      ["update", { awardId: award.id }],
      ["delete", { awardId: award.id }],
      ["run", {}],
      ["grant", { userId: member.id, awardId: award.id }],
      ["revoke", { memberAwardId: grant.id }],
    ] as const)
      await expect(
        execute(ctx, getOperation(`awards.${name}`), admin, input),
      ).rejects.toBeInstanceOf(ForbiddenError);
    for (const name of ["member", "memberGrants"])
      await expect(
        execute(ctx, getOperation(`awards.${name}`), admin, { userId: member.id }),
      ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("the rule of an award", () => {
  test("only those who manage awards read it; everyone else gets an empty rule", async () => {
    const { ctx, member, call } = setup();
    const other = insertUser(ctx);
    const rule = {
      match: "any",
      conditions: [
        { criterion: "is_member", ids: [other.id] },
        { criterion: "in_group", ids: [3] },
      ],
    };
    const empty = { match: "all", conditions: [] };
    const award = await call("create", { name: "Secret", tier: "gold", rule });
    expect(award.rule).toEqual(rule);
    const asMember = (name: string, input: unknown = {}) =>
      execute(ctx, getOperation(`awards.${name}`), userActor(member), input);
    const asGuest = (name: string, input: unknown = {}) =>
      execute(ctx, getOperation(`awards.${name}`), GUEST, input);
    expect((await call("get", { awardId: award.id })).rule).toEqual(rule);
    expect((await call("list")).items[0].rule).toEqual(rule);
    expect((await call("update", { awardId: award.id, name: "Secret 2" })).rule).toEqual(rule);
    expect((await asMember("get", { awardId: award.id })).rule).toEqual(empty);
    expect((await asMember("list")).items[0].rule).toEqual(empty);
    expect((await asGuest("get", { awardId: award.id })).rule).toEqual(empty);
    // Held awards, holders and grants carry the award too: none shows the rule.
    const grant = await call("grant", { userId: other.id, awardId: award.id });
    expect(grant.award.rule).toEqual(empty);
    expect((await asMember("holders", { awardId: award.id })).items[0].award.rule).toEqual(empty);
    expect((await asMember("member", { userId: other.id })).items[0].award.rule).toEqual(empty);
    // The stored rule is untouched by all of that.
    expect((await call("get", { awardId: award.id })).rule).toEqual(rule);
  });
});
