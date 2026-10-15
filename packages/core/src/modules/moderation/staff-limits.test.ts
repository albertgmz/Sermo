import { describe, expect, test } from "bun:test";
import {
  createTestContext,
  expectNoTableScan,
  insertNode,
  insertUser,
  userActor,
} from "@sermo/core/testing";
import { GUEST } from "../../actor";
import { type Ctx, invalidate } from "../../context";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  RateLimitedError,
  UnauthenticatedError,
  ValidationError,
} from "../../errors";
import { execute } from "../../operation";
import { getOperation } from "../../operations";
import { PERMISSIONS } from "../../permissions";
import { resolvedActor, sharedDatabase } from "../../permissions/test-contexts";
import { threadsCreateOp } from "../forums";
import { customMember, setEntry } from "../permissions/group-fixture";
import { warningDaySql } from ".";

const DAY = 86_400_000;
const MODERATORS = 3;
const run = (ctx: Ctx, name: string, actor: Parameters<typeof execute>[2], input: object = {}) =>
  // biome-ignore lint/suspicious/noExplicitAny: operations are called by name, their output is loosely typed
  execute(ctx, getOperation(name), actor, input) as Promise<any>;

function world() {
  const ctx = createTestContext();
  const admin = userActor(insertUser(ctx, { groupId: 4 }));
  const moderator = userActor(insertUser(ctx, { groupId: MODERATORS }));
  const memberRow = insertUser(ctx);
  const member = userActor(memberRow);
  const category = insertNode(ctx, { type: "category" });
  const forumA = insertNode(ctx, { parentId: category.id });
  const forumB = insertNode(ctx, { parentId: category.id });
  invalidate(ctx, "node_tree");
  const warn = (actor: Parameters<typeof execute>[2], extra: object = {}) =>
    run(ctx, "warnings.create", actor, {
      userId: memberRow.id,
      points: 1,
      reason: "Rude",
      ...extra,
    });
  const post = async (nodeId: number, author = member) =>
    (await execute(ctx, threadsCreateOp, author, { nodeId, title: "T", body: "B" })) as {
      post: { id: number };
    };
  const warnings = () =>
    ctx.sqlite
      .prepare<{ id: number; points: number; expires_at: number | null }, []>(
        "SELECT id, points, expires_at FROM warnings ORDER BY id",
      )
      .all();
  return { ctx, admin, moderator, memberRow, member, forumA, forumB, warn, post, warnings };
}

describe("registry shapes", () => {
  test("moderators are bounded, administrators are not, and the tools are staff's", () => {
    expect(PERMISSIONS["warning.maxPoints"].defaults).toEqual({ moderator: 10, admin: -1 });
    expect(PERMISSIONS["warning.perDay"].defaults).toEqual({ moderator: 20, admin: -1 });
    expect(PERMISSIONS["member.banMaxDays"].defaults).toEqual({ moderator: 30, admin: -1 });
    expect(PERMISSIONS["member.ban"].defaults).toEqual({ moderator: "allow", admin: "allow" });
    for (const id of ["warning.delete", "member.editProfile", "forum.warn"] as const) {
      expect(PERMISSIONS[id].defaults).toEqual({ moderator: "allow", admin: "allow" });
      expect(PERMISSIONS[id]).toMatchObject({ hierarchy: true });
    }
  });
});

describe("warning.maxPoints", () => {
  test("a custom warning above the moderator's value is refused, at it is given", async () => {
    const w = world();
    await expect(w.warn(w.moderator, { points: 11 })).rejects.toBeInstanceOf(ForbiddenError);
    await w.warn(w.moderator, { points: 10 });
    expect(w.warnings().map((row) => row.points)).toEqual([10]);
    await w.warn(w.admin, { points: 500 });
    expect(w.warnings()).toHaveLength(2);
  });

  test("a warning type above the value is refused for the moderator, and not for an administrator", async () => {
    const w = world();
    const heavy = await run(w.ctx, "warningTypes.create", w.admin, {
      nameEn: "Heavy",
      nameEs: "Pesada",
      points: 15,
      expiryDays: 30,
      defaultReason: "Abuse",
    });
    const light = await run(w.ctx, "warningTypes.create", w.admin, {
      nameEn: "Light",
      nameEs: "Ligera",
      points: 2,
      expiryDays: 30,
      defaultReason: "Noise",
    });
    await expect(
      w.warn(w.moderator, { typeId: heavy.id, points: undefined }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await w.warn(w.moderator, { typeId: light.id, points: undefined });
    await w.warn(w.admin, { typeId: heavy.id, points: undefined });
    expect(w.warnings().map((row) => row.points)).toEqual([2, 15]);
  });

  test("a group with member.warn and no value is held to the built-in ceiling; the value it is given replaces it", async () => {
    const w = world();
    const bare = customMember(w.ctx, ["member.warn"], 20);
    // No entry in any group: the registry's built-in value (10 points), not none.
    await w.warn(bare.actor, { points: 10 });
    await expect(w.warn(bare.actor, { points: 11 })).rejects.toBeInstanceOf(ForbiddenError);
    setEntry(w.ctx, bare.groupId, "warning.maxPoints", 3);
    setEntry(w.ctx, bare.groupId, "warning.perDay", -1);
    await w.warn(bare.actor, { points: 3 });
    await expect(w.warn(bare.actor, { points: 4 })).rejects.toBeInstanceOf(ForbiddenError);
  });

  test("a group with member.warn and no daily value is held to the built-in 20 a day", async () => {
    const w = world();
    const bare = customMember(w.ctx, ["member.warn"], 20);
    for (let i = 0; i < 20; i++) await w.warn(bare.actor);
    await expect(w.warn(bare.actor)).rejects.toBeInstanceOf(RateLimitedError);
  });

  test("the highest value of a member's groups applies", async () => {
    const w = world();
    const first = customMember(
      w.ctx,
      ["member.warn", ["warning.maxPoints", 2], ["warning.perDay", -1]],
      20,
    );
    const second = customMember(w.ctx, [["warning.maxPoints", 6]], 5);
    w.ctx.sqlite
      .prepare("INSERT INTO user_groups (user_id, group_id, created_at) VALUES (?1, ?2, 0)")
      .run(first.row.id, second.groupId);
    w.ctx.sqlite
      .prepare("UPDATE cache_versions SET version = version + 1 WHERE key = 'permissions'")
      .run();
    const actor = resolvedActor(w.ctx, first.row.id);
    await w.warn(actor, { points: 6 });
    await expect(w.warn(actor, { points: 7 })).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("warning.perDay", () => {
  test("a moderator is held to the number in 24 hours, deleting does not free a place, and the day passes", async () => {
    const w = world();
    const limited = customMember(
      w.ctx,
      ["member.warn", "warning.delete", ["warning.maxPoints", -1], ["warning.perDay", 2]],
      20,
    );
    await w.warn(limited.actor);
    await w.warn(limited.actor);
    await expect(w.warn(limited.actor)).rejects.toBeInstanceOf(RateLimitedError);
    // Taking a warning away does not give the place back.
    await run(w.ctx, "warnings.delete", w.admin, { warningId: w.warnings()[0]!.id });
    await expect(w.warn(limited.actor)).rejects.toBeInstanceOf(RateLimitedError);
    // Another moderator and an administrator count on their own.
    await w.warn(w.moderator);
    await w.warn(w.admin);
    w.ctx.clock.advance(DAY + 1000);
    await w.warn(limited.actor);
  });

  test("an explicit 0 allows none and -1 is unlimited", async () => {
    const w = world();
    const none = customMember(
      w.ctx,
      ["member.warn", ["warning.maxPoints", -1], ["warning.perDay", 0]],
      20,
    );
    await expect(w.warn(none.actor)).rejects.toBeInstanceOf(ForbiddenError);
    setEntry(w.ctx, none.groupId, "warning.perDay", -1);
    for (let i = 0; i < 25; i++) await w.warn(none.actor);
    expect(w.warnings()).toHaveLength(25);
  });

  test("the count is an index seek on the log", () => {
    const w = world();
    expectNoTableScan(w.ctx, warningDaySql, [1, 4]);
  });
});

describe("forum.warn", () => {
  test("a warning about a post needs forum.warn in that post's forum, and nothing else", async () => {
    const w = world();
    const inA = await w.post(w.forumA.id);
    const inB = await w.post(w.forumB.id);
    const forumModerator = customMember(
      w.ctx,
      [
        "node.view",
        "forum.viewOthers",
        "forum.viewContent",
        ["warning.maxPoints", -1],
        ["warning.perDay", -1],
      ],
      20,
    );
    setEntry(w.ctx, forumModerator.groupId, "forum.warn", 1, w.forumA.id);
    await w.warn(forumModerator.actor, { postId: inA.post.id });
    await expect(w.warn(forumModerator.actor, { postId: inB.post.id })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    // Without a post it is member.warn that decides, which this group lacks.
    await expect(w.warn(forumModerator.actor)).rejects.toBeInstanceOf(ForbiddenError);
    const logged = w.ctx.sqlite
      .prepare<{ details: string }, []>(
        "SELECT details FROM moderator_log WHERE action = 'warning.add'",
      )
      .all();
    expect(JSON.parse(logged[0]!.details).postId).toBe(inA.post.id);
  });

  test("taking a forum from a moderator stops warnings about its posts, not the ones without a post", async () => {
    const w = world();
    const inB = await w.post(w.forumB.id);
    setEntry(w.ctx, MODERATORS, "forum.warn", -1, w.forumB.id);
    await expect(w.warn(w.moderator, { postId: inB.post.id })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await w.warn(w.moderator);
    const inA = await w.post(w.forumA.id);
    await w.warn(w.moderator, { postId: inA.post.id });
    expect(w.warnings()).toHaveLength(2);
  });

  test("the post must be the member's and visible to the moderator", async () => {
    const w = world();
    const other = userActor(insertUser(w.ctx));
    const theirs = await w.post(w.forumA.id, other);
    await expect(w.warn(w.moderator, { postId: theirs.post.id })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(w.warn(w.moderator, { postId: 99999 })).rejects.toBeInstanceOf(NotFoundError);
    const hidden = insertNode(w.ctx, { parentId: w.forumA.id });
    invalidate(w.ctx, "node_tree");
    const secret = await w.post(hidden.id);
    setEntry(w.ctx, MODERATORS, "node.view", -1, hidden.id);
    await expect(w.warn(w.moderator, { postId: secret.post.id })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  test("guests and members are refused", async () => {
    const w = world();
    const inA = await w.post(w.forumA.id);
    await expect(w.warn(GUEST, { postId: inA.post.id })).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
    await expect(w.warn(w.member, { postId: inA.post.id })).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("warning.delete", () => {
  test("a moderator deletes a warning: it leaves the list, the log keeps it, the points are told", async () => {
    const w = world();
    await w.warn(w.moderator, { points: 4 });
    const kept = await w.warn(w.moderator, { points: 2 });
    const [first] = w.warnings();
    const result = await run(w.ctx, "warnings.delete", w.moderator, {
      warningId: first!.id,
      reason: "Mistake",
    });
    expect(result).toEqual({ activePoints: 2 });
    expect(w.warnings().map((row) => row.id)).toEqual([kept.id]);
    const log = w.ctx.sqlite
      .prepare<{ reason: string; details: string }, []>(
        "SELECT reason, details FROM moderator_log WHERE action = 'warning.delete'",
      )
      .all();
    expect(log).toHaveLength(1);
    expect(log[0]!.reason).toBe("Mistake");
    expect(JSON.parse(log[0]!.details)).toMatchObject({ warningId: first!.id, points: 4 });
  });

  test("a warning an administrator gave is not deleted or ended by a moderator", async () => {
    const w = world();
    const given = await w.warn(w.admin, { points: 1 });
    for (const name of ["warnings.delete", "warnings.expire"])
      await expect(run(w.ctx, name, w.moderator, { warningId: given.id })).rejects.toBeInstanceOf(
        ForbiddenError,
      );
    await run(w.ctx, "warnings.expire", w.admin, { warningId: given.id });
  });

  test("expiring ends the warning but keeps it in the list, and twice is a conflict", async () => {
    const w = world();
    const warning = await w.warn(w.moderator, { points: 3 });
    expect(await run(w.ctx, "warnings.expire", w.moderator, { warningId: warning.id })).toEqual({
      activePoints: 0,
    });
    const row = w.warnings()[0]!;
    expect(row.expires_at).toBe(w.ctx.now());
    await expect(
      run(w.ctx, "warnings.expire", w.moderator, { warningId: warning.id }),
    ).rejects.toBeInstanceOf(ConflictError);
    const listed = await run(w.ctx, "warnings.list", w.moderator, { userId: w.memberRow.id });
    expect(listed.items).toHaveLength(1);
  });

  test("members, guests, groups without it, the unknown and one's own are refused", async () => {
    const w = world();
    const warning = await w.warn(w.moderator);
    const input = { warningId: warning.id };
    await expect(run(w.ctx, "warnings.delete", GUEST, input)).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
    await expect(run(w.ctx, "warnings.delete", w.member, input)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    const lacking = customMember(w.ctx, ["member.warn"], 20);
    await expect(run(w.ctx, "warnings.expire", lacking.actor, input)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(
      run(w.ctx, "warnings.delete", w.moderator, { warningId: 99999 }),
    ).rejects.toBeInstanceOf(NotFoundError);
    // Warnings of a member who ranks as high, or of oneself, are out of reach.
    const peer = userActor(insertUser(w.ctx, { groupId: MODERATORS }));
    const own = await run(w.ctx, "warnings.create", w.admin, {
      userId: (peer as { userId: number }).userId,
      points: 1,
      reason: "x",
    });
    await expect(
      run(w.ctx, "warnings.delete", w.moderator, { warningId: own.id }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(run(w.ctx, "warnings.delete", peer, { warningId: own.id })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(w.warnings()).toHaveLength(2);
    // The group that holds it, with the permission alone and the giver's rank, may.
    const holder = customMember(w.ctx, ["warning.delete"], 50);
    await run(w.ctx, "warnings.delete", holder.actor, input);
  });

  test("an automatic action that the points no longer reach is lifted in the same call", async () => {
    for (const how of ["warnings.delete", "warnings.expire"]) {
      const w = world();
      const probation = w.ctx.sqlite
        .prepare<{ id: number }, []>(
          "INSERT INTO groups (title, rank) VALUES ('Probation', 1) RETURNING id",
        )
        .get()!.id;
      await run(w.ctx, "warningActions.create", w.admin, {
        threshold: 3,
        kind: "group",
        groupId: probation,
        days: 30,
      });
      const warning = await w.warn(w.moderator, { points: 3 });
      const inGroup = () =>
        w.ctx.sqlite
          .prepare<{ n: number }, [number, number]>(
            "SELECT count(*) AS n FROM user_groups WHERE user_id = ?1 AND group_id = ?2",
          )
          .get(w.memberRow.id, probation)!.n;
      expect(inGroup()).toBe(1);
      await run(w.ctx, how, w.moderator, { warningId: warning.id });
      expect(inGroup()).toBe(0);
      expect(
        w.ctx.sqlite
          .prepare<{ n: number }, []>("SELECT count(*) AS n FROM warning_action_fires")
          .get()!.n,
      ).toBe(0);
      // Warned again, the action fires again.
      await w.warn(w.moderator, { points: 3 });
      expect(inGroup()).toBe(1);
    }
  });
});

describe("member.banMaxDays", () => {
  const ban = (
    w: ReturnType<typeof world>,
    actor: Parameters<typeof execute>[2],
    days: number | null,
  ) =>
    run(w.ctx, "bans.create", actor, {
      userId: w.memberRow.id,
      reason: "Rude",
      expiresAt: days === null ? null : new Date(w.ctx.now() + days * DAY).toISOString(),
    });

  test("a moderator bans up to the days of their value, never for good", async () => {
    const w = world();
    await ban(w, w.moderator, 30);
    await expect(ban(w, w.moderator, 31)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(ban(w, w.moderator, null)).rejects.toBeInstanceOf(ForbiddenError);
    await ban(w, w.admin, null);
    await ban(w, w.admin, 400);
  });

  test("a group with member.ban and no value bans up to the built-in 30 days; an explicit 0 bans none, -1 allows a permanent ban", async () => {
    const w = world();
    const bare = customMember(w.ctx, ["member.ban"], 20);
    await ban(w, bare.actor, 30);
    await expect(ban(w, bare.actor, 31)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(ban(w, bare.actor, null)).rejects.toBeInstanceOf(ForbiddenError);
    setEntry(w.ctx, bare.groupId, "member.banMaxDays", 0);
    await expect(ban(w, bare.actor, 1)).rejects.toBeInstanceOf(ForbiddenError);
    setEntry(w.ctx, bare.groupId, "member.banMaxDays", 2);
    await ban(w, bare.actor, 2);
    await expect(ban(w, bare.actor, 3)).rejects.toBeInstanceOf(ForbiddenError);
    setEntry(w.ctx, bare.groupId, "member.banMaxDays", -1);
    await ban(w, bare.actor, null);
  });

  test("a value lowered in another process is honoured inside the write", async () => {
    const fixture = createTestContext();
    const founder = userActor(insertUser(fixture, { groupId: 4 }));
    const staff = customMember(fixture, ["member.ban", ["member.banMaxDays", 30]], 20);
    const member = insertUser(fixture);
    const database = sharedDatabase(fixture);
    try {
      const here = database.open();
      const elsewhere = database.open();
      const actor = resolvedActor(here, staff.row.id);
      await execute(elsewhere, getOperation("permissions.set"), founder, {
        groupId: staff.groupId,
        entries: [{ permission: "member.banMaxDays", value: 1 }],
      } as never);
      await expect(
        run(here, "bans.create", actor, {
          userId: member.id,
          reason: "Rude",
          expiresAt: new Date(here.now() + 10 * DAY).toISOString(),
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      expect(
        elsewhere.sqlite.prepare<{ n: number }, []>("SELECT count(*) AS n FROM bans").get()!.n,
      ).toBe(0);
    } finally {
      database.close();
    }
  });
});

describe("stale actors", () => {
  test("warning.delete is refused to a moderator revoked meanwhile", async () => {
    const fixture = createTestContext();
    const founder = userActor(insertUser(fixture, { groupId: 4 }));
    const staff = customMember(fixture, ["warning.delete"], 20);
    const member = insertUser(fixture);
    const warned = (await run(fixture, "warnings.create", founder, {
      userId: member.id,
      points: 1,
      reason: "x",
    })) as { id: number };
    const database = sharedDatabase(fixture);
    try {
      const here = database.open();
      const elsewhere = database.open();
      const actor = resolvedActor(here, staff.row.id);
      await execute(elsewhere, getOperation("permissions.set"), founder, {
        groupId: staff.groupId,
        entries: [{ permission: "warning.delete", value: "unset" }],
      } as never);
      for (const name of ["warnings.delete", "warnings.expire"])
        await expect(run(here, name, actor, { warningId: warned.id })).rejects.toBeInstanceOf(
          ForbiddenError,
        );
      expect(
        elsewhere.sqlite.prepare<{ n: number }, []>("SELECT count(*) AS n FROM warnings").get()!.n,
      ).toBe(1);
    } finally {
      database.close();
    }
  });

  test("warnings.create with a limit lowered meanwhile is refused", async () => {
    const fixture = createTestContext();
    const founder = userActor(insertUser(fixture, { groupId: 4 }));
    const staff = customMember(
      fixture,
      ["member.warn", ["warning.maxPoints", 5], ["warning.perDay", -1]],
      20,
    );
    const member = insertUser(fixture);
    const database = sharedDatabase(fixture);
    try {
      const here = database.open();
      const elsewhere = database.open();
      const actor = resolvedActor(here, staff.row.id);
      await execute(elsewhere, getOperation("permissions.set"), founder, {
        groupId: staff.groupId,
        entries: [{ permission: "warning.maxPoints", value: 1 }],
      } as never);
      await expect(
        run(here, "warnings.create", actor, { userId: member.id, points: 4, reason: "x" }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    } finally {
      database.close();
    }
  });
});

describe("lifting a ban", () => {
  const input = (
    w: ReturnType<typeof world>,
    who: Parameters<typeof execute>[2],
    days: number | null,
  ) =>
    run(w.ctx, "bans.create", who, {
      userId: w.memberRow.id,
      reason: "Rude",
      expiresAt: days === null ? null : new Date(w.ctx.now() + days * DAY).toISOString(),
    });
  const lift = (w: ReturnType<typeof world>, who: Parameters<typeof execute>[2], id: number) =>
    run(w.ctx, "bans.lift", who, { banId: id, reason: "Sorry" });

  test("a moderator lifts only a ban they could set, and not one a higher-ranked member set", async () => {
    const w = world();
    const permanent = await input(w, w.admin, null);
    await expect(lift(w, w.moderator, permanent.id)).rejects.toBeInstanceOf(ForbiddenError);
    await lift(w, w.admin, permanent.id);
    const years = await input(w, w.admin, 5 * 365);
    await expect(lift(w, w.moderator, years.id)).rejects.toBeInstanceOf(ForbiddenError);
    // Short, but put on by a member of higher rank.
    const shortByAdmin = await input(w, w.admin, 5);
    await lift(w, w.admin, years.id);
    await expect(lift(w, w.moderator, shortByAdmin.id)).rejects.toBeInstanceOf(ForbiddenError);
    await lift(w, w.admin, shortByAdmin.id);
    // Their own, and a peer's, within the bound.
    const own = await input(w, w.moderator, 10);
    await lift(w, w.moderator, own.id);
    const peer = userActor(insertUser(w.ctx, { groupId: MODERATORS }));
    const theirs = await input(w, peer, 10);
    await lift(w, w.moderator, theirs.id);
    expect(
      w.ctx.sqlite
        .prepare<{ n: number }, []>("SELECT count(*) AS n FROM bans WHERE lifted_at IS NULL")
        .get()!.n,
    ).toBe(0);
  });

  test("the bound is the holder's own: -1 lifts a permanent ban, a smaller value lifts less", async () => {
    const w = world();
    const wide = customMember(w.ctx, ["member.ban", ["member.banMaxDays", -1]], 60);
    const narrow = customMember(w.ctx, ["member.ban", ["member.banMaxDays", 3]], 60);
    const permanent = await input(w, wide.actor, null);
    await expect(lift(w, narrow.actor, permanent.id)).rejects.toBeInstanceOf(ForbiddenError);
    await lift(w, wide.actor, permanent.id);
    const week = await input(w, wide.actor, 7);
    await expect(lift(w, narrow.actor, week.id)).rejects.toBeInstanceOf(ForbiddenError);
    const two = await input(w, wide.actor, 2);
    await lift(w, narrow.actor, two.id);
  });
});
