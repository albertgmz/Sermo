import { describe, expect, test } from "bun:test";
import {
  createTestContext,
  expectNoTableScan,
  insertNode,
  insertUser,
  userActor,
} from "@sermo/core/testing";
import { GUEST } from "../../actor";
import { invalidate } from "../../context";
import { writeTx } from "../../db/tx";
import { ForbiddenError, UnauthenticatedError, ValidationError } from "../../errors";
import { dispatchEvents, publishEvent } from "../../events";
import { execute } from "../../operation";
import { getOperation } from "../../operations";
import { enqueueJob, runDueJobs } from "../jobs/queue";
import { criteria, eligible } from "./criteria";
import { deletePromotionChunk, evaluateMember, registerPromotionJobs, sweepChunk } from "./index";

const op = (name: string) => getOperation(`promotions.${name}`);
const group = (ctx: ReturnType<typeof createTestContext>, rank = 30) =>
  ctx.sqlite
    .prepare<{ id: number }, [number]>(
      "INSERT INTO groups (title, rank) VALUES ('Promoted', ?1) RETURNING id",
    )
    .get(rank)!.id;

describe("promotions", () => {
  test("the criteria registry evaluates all conditions", () => {
    const now = Date.UTC(2026, 0, 10);
    const facts = {
      post_count: 4,
      created_at: now - 10 * 86_400_000,
      reaction_score: 3,
      email_verified: 1,
      avatar_file_id: 8,
      last_activity_at: now - 2 * 86_400_000,
      warning_points: 1,
    };
    expect(criteria).toHaveLength(8);
    expect(
      eligible(
        facts,
        [
          { criterion: "post_count", value: 4 },
          { criterion: "days_registered", value: 10 },
          { criterion: "reaction_score", value: 3 },
          { criterion: "email_verified", value: 1 },
          { criterion: "has_avatar", value: 1 },
          { criterion: "active_within_days", value: 2 },
          { criterion: "inactive_days", value: 2 },
          { criterion: "warning_points_below", value: 2 },
        ],
        now,
      ),
    ).toBe(true);
    expect(
      eligible(
        { ...facts, last_activity_at: null },
        [{ criterion: "active_within_days", value: 100 }],
        now,
      ),
    ).toBe(false);
    expect(
      eligible(
        { ...facts, last_activity_at: null },
        [{ criterion: "inactive_days", value: 100 }],
        now,
      ),
    ).toBe(true);
    expect(eligible(facts, [{ criterion: "warning_points_below", value: 1 }], now)).toBe(false);
  });
  test("automatic, manual, exempt, reset, and hand-assigned groups", async () => {
    const ctx = createTestContext();
    const admin = userActor(insertUser(ctx, { groupId: 4 }));
    const member = insertUser(ctx);
    const id = group(ctx);
    const create = op("create");
    await expect(
      execute(ctx, create, GUEST, {
        title: "Posts",
        criteria: [{ criterion: "post_count", value: 1 }],
        groupIds: [id],
      }),
    ).rejects.toBeInstanceOf(UnauthenticatedError);
    await expect(
      execute(ctx, create, admin, {
        title: "Bad",
        criteria: [{ criterion: "missing", value: 1 }],
        groupIds: [id],
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    const p = (await execute(ctx, create, admin, {
      title: "Posts",
      criteria: [{ criterion: "post_count", value: 1 }],
      groupIds: [id],
    })) as { id: number };
    expect(sweepChunk(ctx)).toBeGreaterThan(0);
    expect(ctx.sqlite.prepare("SELECT id FROM promotion_log").all()).toHaveLength(0);
    ctx.sqlite.prepare("UPDATE users SET post_count = 1 WHERE id = ?1").run(member.id);
    sweepChunk(ctx);
    expect(
      ctx.sqlite.prepare("SELECT id FROM user_group_grants WHERE user_id = ?1").all(member.id),
    ).toHaveLength(1);
    const profile = (await execute(ctx, getOperation("profiles.get"), GUEST, {
      userId: member.id,
    })) as { displayGroup: { id: number } };
    expect(profile.displayGroup.id).toBe(id);
    const count = () =>
      ctx.sqlite.prepare<{ n: number }, []>("SELECT count(*) AS n FROM promotion_log").get()!.n;
    expect(count()).toBe(1);
    sweepChunk(ctx);
    expect(count()).toBe(1);
    ctx.sqlite
      .prepare("INSERT INTO user_groups (user_id, group_id, created_at) VALUES (?1, ?2, 0)")
      .run(member.id, id);
    ctx.sqlite.prepare("UPDATE users SET post_count = 0 WHERE id = ?1").run(member.id);
    sweepChunk(ctx);
    expect(
      ctx.sqlite.prepare("SELECT id FROM user_group_grants WHERE user_id = ?1").all(member.id),
    ).toHaveLength(0);
    expect(
      ctx.sqlite.prepare("SELECT id FROM user_groups WHERE user_id = ?1").all(member.id),
    ).toHaveLength(1);
    await execute(ctx, op("apply"), admin, {
      userId: member.id,
      promotionId: p.id,
      action: "promote",
    });
    sweepChunk(ctx);
    expect(
      ctx.sqlite.prepare("SELECT state FROM user_promotions WHERE user_id = ?1").get(member.id),
    ).toEqual({ state: "manual" });
    expect(
      ctx.sqlite
        .prepare("SELECT group_id FROM user_group_grants WHERE user_id = ?1")
        .get(member.id),
    ).toEqual({ group_id: id });
    await execute(ctx, op("apply"), admin, {
      userId: member.id,
      promotionId: p.id,
      action: "exempt",
    });
    sweepChunk(ctx);
    expect(
      ctx.sqlite.prepare("SELECT id FROM user_group_grants WHERE user_id = ?1").all(member.id),
    ).toHaveLength(0);
    await execute(ctx, op("apply"), admin, {
      userId: member.id,
      promotionId: p.id,
      action: "reset",
    });
    expect(
      ctx.sqlite.prepare("SELECT id FROM user_promotions WHERE user_id = ?1").all(member.id),
    ).toHaveLength(0);
    ctx.sqlite.prepare("UPDATE users SET post_count = 1 WHERE id = ?1").run(member.id);
    await execute(ctx, op("apply"), admin, {
      userId: member.id,
      promotionId: p.id,
      action: "reset",
    });
    expect(
      ctx.sqlite.prepare("SELECT state FROM user_promotions WHERE user_id = ?1").get(member.id),
    ).toEqual({ state: "auto" });
  });

  test("hierarchy, events, and indexed log pages", async () => {
    const ctx = createTestContext();
    const admin = userActor(insertUser(ctx, { groupId: 4 }));
    const peer = insertUser(ctx, { groupId: 4 });
    const member = insertUser(ctx);
    const id = group(ctx);
    const p = (await execute(ctx, op("create"), admin, {
      title: "Scores",
      criteria: [{ criterion: "reaction_score", value: 1 }],
      groupIds: [id],
    })) as { id: number };
    await expect(
      execute(ctx, op("apply"), admin, { userId: peer.id, promotionId: p.id, action: "promote" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    registerPromotionJobs(ctx);
    ctx.sqlite.prepare("UPDATE users SET reaction_score = 1 WHERE id = ?1").run(member.id);
    ctx.sqlite
      .prepare(
        "INSERT INTO domain_events (type, target_type, target_id, payload, created_at) VALUES ('reaction.added', 'post', 1, ?1, ?2)",
      )
      .run(JSON.stringify({ contentUserId: member.id }), ctx.now());
    await dispatchEvents(ctx);
    expect(
      ctx.sqlite.prepare("SELECT id FROM user_group_grants WHERE user_id = ?1").all(member.id),
    ).toHaveLength(1);
    const event = ctx.sqlite
      .prepare<{ payload: string }, [number]>(
        "SELECT payload FROM domain_events WHERE type = 'member.groups_changed' AND target_id = ?1",
      )
      .get(member.id)!;
    expect(JSON.parse(event.payload)).toEqual({
      added: [id],
      removed: [],
      source: "promotion",
      promotionId: p.id,
    });
    const extra = group(ctx, 25);
    await execute(ctx, getOperation("users.setGroups"), admin, {
      userId: member.id,
      secondaryGroupIds: [extra],
    });
    const adminEvent = ctx.sqlite
      .prepare<{ payload: string }, [number]>(
        "SELECT payload FROM domain_events WHERE type = 'member.groups_changed' AND target_id = ?1 ORDER BY id DESC LIMIT 1",
      )
      .get(member.id)!;
    expect(JSON.parse(adminEvent.payload)).toEqual({
      added: [extra],
      removed: [],
      source: "admin",
      actorId: admin.kind === "guest" ? null : admin.userId,
    });
    const page = (await execute(ctx, op("log"), admin, { limit: 10, userId: member.id })) as {
      items: unknown[];
    };
    expect(page.items).toHaveLength(1);
    expectNoTableScan(
      ctx,
      "SELECT * FROM promotion_log WHERE user_id = ?1 AND id < ?2 ORDER BY id DESC LIMIT ?3",
      [member.id, 999, 10],
    );
    expectNoTableScan(
      ctx,
      "SELECT * FROM promotion_log WHERE id < ?1 ORDER BY id DESC LIMIT ?2",
      [999, 10],
    );
    expectNoTableScan(
      ctx,
      "SELECT u.id, u.group_id, u.post_count, u.created_at, u.reaction_score, u.avatar_file_id, u.last_activity_at, a.email_verified, 0 AS warning_points FROM users u JOIN auth_user a ON a.id = u.id WHERE u.id > ?1 ORDER BY u.id LIMIT ?2",
      [0, 200],
    );
    expectNoTableScan(
      ctx,
      "SELECT user_id, promotion_id, state FROM user_promotions WHERE user_id IN (SELECT value FROM json_each(?1))",
      [JSON.stringify([member.id])],
    );
    expectNoTableScan(
      ctx,
      "SELECT user_id, promotion_id, group_id FROM user_group_grants WHERE user_id IN (SELECT value FROM json_each(?1)) ORDER BY user_id, promotion_id, group_id",
      [JSON.stringify([member.id])],
    );
    expectNoTableScan(
      ctx,
      "SELECT user_id, group_id FROM user_groups WHERE user_id IN (SELECT value FROM json_each(?1))",
      [JSON.stringify([member.id])],
    );
    expectNoTableScan(
      ctx,
      "SELECT user_id, sum(points) AS points FROM warnings WHERE user_id IN (SELECT value FROM json_each(?1)) AND (expires_at IS NULL OR expires_at > ?2) GROUP BY user_id",
      [JSON.stringify([member.id]), ctx.now()],
    );
  });

  test("post creation evaluates the author and deletion revokes grants", async () => {
    const ctx = createTestContext();
    const admin = userActor(insertUser(ctx, { groupId: 4 }));
    const member = insertUser(ctx);
    const id = group(ctx);
    const forum = insertNode(ctx, {});
    invalidate(ctx, "node_tree");
    const p = (await execute(ctx, op("create"), admin, {
      title: "Poster",
      criteria: [{ criterion: "post_count", value: 1 }],
      groupIds: [id],
    })) as { id: number };
    registerPromotionJobs(ctx);
    await execute(ctx, getOperation("threads.create"), userActor(member), {
      nodeId: forum.id,
      title: "First",
      body: "Hello",
    });
    await dispatchEvents(ctx);
    expect(
      ctx.sqlite.prepare("SELECT id FROM user_group_grants WHERE user_id = ?1").all(member.id),
    ).toHaveLength(1);
    await execute(ctx, op("update"), admin, { promotionId: p.id, isActive: false });
    sweepChunk(ctx);
    expect(
      ctx.sqlite.prepare("SELECT id FROM user_group_grants WHERE user_id = ?1").all(member.id),
    ).toHaveLength(0);
    await execute(ctx, op("update"), admin, { promotionId: p.id, isActive: true });
    sweepChunk(ctx);
    await execute(ctx, op("delete"), admin, { promotionId: p.id });
    expect(await runDueJobs(ctx, { limit: 10 })).toBe(1);
    expect(
      ctx.sqlite.prepare("SELECT id FROM user_group_grants WHERE user_id = ?1").all(member.id),
    ).toHaveLength(0);
    expect(
      ctx.sqlite.prepare("SELECT id FROM user_promotions WHERE user_id = ?1").all(member.id),
    ).toHaveLength(0);
    expect(
      ctx.sqlite
        .prepare<{ action: string }, [number]>(
          "SELECT action FROM promotion_log WHERE user_id = ?1 ORDER BY id DESC LIMIT 1",
        )
        .get(member.id)?.action,
    ).toBe("demote");
  });

  test("a queued sweep resumes after a full chunk", async () => {
    const ctx = createTestContext();
    const admin = userActor(insertUser(ctx, { groupId: 4 }));
    const id = group(ctx);
    await execute(ctx, op("create"), admin, {
      title: "Verified",
      criteria: [{ criterion: "email_verified", value: 1 }],
      groupIds: [id],
    });
    let last = 0;
    for (let i = 0; i < 201; i++) last = insertUser(ctx).id;
    ctx.sqlite.prepare("UPDATE auth_user SET email_verified = 1 WHERE id = ?1").run(last);
    registerPromotionJobs(ctx);
    enqueueJob(ctx, "promotions.sweep", { after: 0 }, { uniqueKey: "promotions.sweep" });
    expect(await runDueJobs(ctx, { limit: 1 })).toBe(1);
    const beforeRetry = ctx.sqlite
      .prepare<{ n: number }, []>("SELECT count(*) AS n FROM promotion_log")
      .get()!.n;
    sweepChunk(ctx, 0);
    expect(
      ctx.sqlite.prepare<{ n: number }, []>("SELECT count(*) AS n FROM promotion_log").get()!.n,
    ).toBe(beforeRetry);
    expect(await runDueJobs(ctx, { limit: 10 })).toBe(1);
    expect(
      ctx.sqlite.prepare("SELECT group_id FROM user_group_grants WHERE user_id = ?1").get(last),
    ).toEqual({ group_id: id });
    expect(await runDueJobs(ctx, { limit: 10 })).toBe(0);
  });

  test("every administration endpoint checks its permission", async () => {
    const ctx = createTestContext();
    const admin = userActor(insertUser(ctx, { groupId: 4 }));
    const member = insertUser(ctx);
    const id = group(ctx);
    const p = (await execute(ctx, op("create"), admin, {
      title: "Rule",
      criteria: [{ criterion: "post_count", value: 1 }],
      groupIds: [id],
    })) as { id: number };
    const inputs: [string, object][] = [
      ["criteria", {}],
      ["list", {}],
      ["get", { promotionId: p.id }],
      [
        "create",
        { title: "Rule", criteria: [{ criterion: "post_count", value: 1 }], groupIds: [id] },
      ],
      ["update", { promotionId: p.id, title: "Other" }],
      ["delete", { promotionId: p.id }],
      ["memberStatus", { userId: member.id }],
      ["apply", { userId: member.id, promotionId: p.id, action: "promote" }],
      ["log", {}],
      ["run", {}],
    ];
    for (const [name, input] of inputs) {
      await expect(execute(ctx, op(name), GUEST, input)).rejects.toBeInstanceOf(
        UnauthenticatedError,
      );
      await expect(execute(ctx, op(name), userActor(member), input)).rejects.toBeInstanceOf(
        ForbiddenError,
      );
    }
  });
  test("rank guards cover creation, update, manual promote, and deletion", async () => {
    const ctx = createTestContext();
    const admin = userActor(insertUser(ctx, { groupId: 4 }));
    const member = insertUser(ctx);
    const safe = group(ctx);
    const high = group(ctx, 1000);
    const input = { title: "Rule", criteria: [{ criterion: "post_count", value: 1 }] };
    for (const groupId of [1, high])
      await expect(
        execute(ctx, op("create"), admin, { ...input, groupIds: [groupId] }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    const p = (await execute(ctx, op("create"), admin, { ...input, groupIds: [safe] })) as {
      id: number;
    };
    for (const groupId of [1, high])
      await expect(
        execute(ctx, op("update"), admin, { promotionId: p.id, groupIds: [groupId] }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    ctx.sqlite.prepare("UPDATE groups SET rank = 1000 WHERE id = ?1").run(safe);
    await expect(
      execute(ctx, op("apply"), admin, { userId: member.id, promotionId: p.id, action: "promote" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(execute(ctx, op("delete"), admin, { promotionId: p.id })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(ctx.sqlite.prepare("SELECT is_active FROM promotions WHERE id = ?1").get(p.id)).toEqual({
      is_active: 1,
    });
  });

  test("manual group edits do not log a demotion and empty groups clear without logging", async () => {
    const ctx = createTestContext();
    const admin = userActor(insertUser(ctx, { groupId: 4 }));
    const member = insertUser(ctx);
    const first = group(ctx);
    const second = group(ctx);
    const p = (await execute(ctx, op("create"), admin, {
      title: "Manual",
      criteria: [{ criterion: "post_count", value: 1 }],
      groupIds: [first],
    })) as { id: number };
    await execute(ctx, op("apply"), admin, {
      userId: member.id,
      promotionId: p.id,
      action: "promote",
    });
    await execute(ctx, op("update"), admin, { promotionId: p.id, groupIds: [second] });
    sweepChunk(ctx);
    expect(
      ctx.sqlite
        .prepare("SELECT group_id FROM user_group_grants WHERE user_id = ?1")
        .get(member.id),
    ).toEqual({ group_id: second });
    expect(
      ctx.sqlite
        .prepare<{ action: string }, [number]>(
          "SELECT action FROM promotion_log WHERE user_id = ?1 ORDER BY id DESC LIMIT 1",
        )
        .get(member.id)?.action,
    ).toBe("promote");
    ctx.sqlite.prepare("UPDATE promotions SET group_ids = '[]' WHERE id = ?1").run(p.id);
    const before = ctx.sqlite
      .prepare<{ n: number }, []>("SELECT count(*) AS n FROM promotion_log")
      .get()!.n;
    sweepChunk(ctx);
    expect(evaluateMember(ctx, member.id)).toBe(0);
    expect(
      ctx.sqlite.prepare("SELECT id FROM user_promotions WHERE user_id = ?1").all(member.id),
    ).toHaveLength(0);
    expect(
      ctx.sqlite.prepare("SELECT id FROM user_group_grants WHERE user_id = ?1").all(member.id),
    ).toHaveLength(0);
    expect(
      ctx.sqlite.prepare<{ n: number }, []>("SELECT count(*) AS n FROM promotion_log").get()!.n,
    ).toBe(before);
    await execute(ctx, op("apply"), admin, {
      userId: member.id,
      promotionId: p.id,
      action: "promote",
    });
    expect(
      ctx.sqlite.prepare("SELECT id FROM user_promotions WHERE user_id = ?1").all(member.id),
    ).toHaveLength(0);
    expect(
      ctx.sqlite.prepare<{ n: number }, []>("SELECT count(*) AS n FROM promotion_log").get()!.n,
    ).toBe(before);
  });

  test("reset reconciles once and publishes only net group changes", async () => {
    const ctx = createTestContext();
    const admin = userActor(insertUser(ctx, { groupId: 4 }));
    const member = insertUser(ctx);
    const id = group(ctx);
    const p = (await execute(ctx, op("create"), admin, {
      title: "Posts",
      criteria: [{ criterion: "post_count", value: 1 }],
      groupIds: [id],
    })) as { id: number };
    ctx.sqlite.prepare("UPDATE users SET post_count = 1 WHERE id = ?1").run(member.id);
    await execute(ctx, op("apply"), admin, {
      userId: member.id,
      promotionId: p.id,
      action: "promote",
    });
    const events = () =>
      ctx.sqlite
        .prepare<{ n: number }, [number]>(
          "SELECT count(*) AS n FROM domain_events WHERE type = 'member.groups_changed' AND target_id = ?1",
        )
        .get(member.id)!.n;
    const before = events();
    const logCount = () =>
      ctx.sqlite
        .prepare<{ n: number }, [number]>(
          "SELECT count(*) AS n FROM promotion_log WHERE user_id = ?1",
        )
        .get(member.id)!.n;
    const beforeLogs = logCount();
    await execute(ctx, op("apply"), admin, {
      userId: member.id,
      promotionId: p.id,
      action: "reset",
    });
    expect(events()).toBe(before);
    expect(logCount()).toBe(beforeLogs + 1);
    expect(
      ctx.sqlite.prepare("SELECT state FROM user_promotions WHERE user_id = ?1").get(member.id),
    ).toEqual({ state: "auto" });
    await execute(ctx, op("apply"), admin, {
      userId: member.id,
      promotionId: p.id,
      action: "demote",
    });
    expect(
      ctx.sqlite.prepare("SELECT state FROM user_promotions WHERE user_id = ?1").get(member.id),
    ).toEqual({ state: "exempt" });
    expect(
      ctx.sqlite.prepare("SELECT id FROM user_group_grants WHERE user_id = ?1").all(member.id),
    ).toHaveLength(0);
    const afterDemote = events();
    const afterDemoteLogs = logCount();
    await execute(ctx, op("apply"), admin, {
      userId: member.id,
      promotionId: p.id,
      action: "reset",
    });
    expect(events()).toBe(afterDemote + 1);
    expect(logCount()).toBe(afterDemoteLogs + 2);
    expect(
      ctx.sqlite
        .prepare<{ action: string }, [number]>(
          "SELECT action FROM promotion_log WHERE user_id = ?1 ORDER BY id DESC LIMIT 1",
        )
        .get(member.id)?.action,
    ).toBe("promote");
    const firstPage = (await execute(ctx, op("log"), admin, { userId: member.id, limit: 1 })) as {
      items: { id: number }[];
      nextCursor: string | null;
    };
    expect(firstPage.nextCursor).not.toBeNull();
    const secondPage = (await execute(ctx, op("log"), admin, {
      userId: member.id,
      limit: 1,
      cursor: firstPage.nextCursor,
    })) as { items: { id: number }[] };
    expect(secondPage.items[0]!.id).toBeLessThan(firstPage.items[0]!.id);
  });

  test("real reaction and warning operations publish promotion events", async () => {
    const ctx = createTestContext();
    const admin = userActor(insertUser(ctx, { groupId: 4 }));
    const author = insertUser(ctx);
    const reactor = insertUser(ctx);
    const id = group(ctx);
    const scoreRule = (await execute(ctx, op("create"), admin, {
      title: "Scores",
      criteria: [{ criterion: "reaction_score", value: 1 }],
      groupIds: [id],
    })) as { id: number };
    const warningRule = (await execute(ctx, op("create"), admin, {
      title: "Warnings",
      criteria: [{ criterion: "warning_points_below", value: 1 }],
      groupIds: [id],
    })) as { id: number };
    registerPromotionJobs(ctx);
    evaluateMember(ctx, author.id);
    const post = (await execute(ctx, getOperation("profilePosts.create"), userActor(author), {
      userId: author.id,
      body: "A post",
    })) as { id: number };
    const reactionType = ctx.sqlite
      .prepare<{ id: number }, []>("SELECT id FROM reaction_types WHERE score > 0 LIMIT 1")
      .get()!.id;
    await execute(ctx, getOperation("reactions.set"), userActor(reactor), {
      contentType: "profile_post",
      contentId: post.id,
      reactionTypeId: reactionType,
    });
    const reaction = ctx.sqlite
      .prepare<{ payload: string }, []>(
        "SELECT payload FROM domain_events WHERE type = 'reaction.added' ORDER BY id DESC LIMIT 1",
      )
      .get()!;
    expect(JSON.parse(reaction.payload)).toEqual({
      userId: reactor.id,
      contentUserId: author.id,
      reactionTypeId: reactionType,
    });
    await dispatchEvents(ctx);
    expect(
      ctx.sqlite
        .prepare("SELECT state FROM user_promotions WHERE user_id = ?1 AND promotion_id = ?2")
        .get(author.id, scoreRule.id),
    ).toEqual({ state: "auto" });
    const autoLogs = ctx.sqlite
      .prepare<{ n: number }, [number]>(
        "SELECT count(*) AS n FROM promotion_log WHERE user_id = ?1",
      )
      .get(author.id)!.n;
    writeTx(ctx, () =>
      publishEvent(ctx, {
        type: "reaction.added",
        targetType: "profile_post",
        targetId: post.id,
        payload: { contentUserId: author.id, userId: reactor.id, reactionTypeId: reactionType },
      }),
    );
    await dispatchEvents(ctx);
    expect(
      ctx.sqlite
        .prepare<{ n: number }, [number]>(
          "SELECT count(*) AS n FROM promotion_log WHERE user_id = ?1",
        )
        .get(author.id)!.n,
    ).toBe(autoLogs);
    const warning = (await execute(ctx, getOperation("warnings.create"), admin, {
      userId: author.id,
      points: 1,
      reason: "Rule break",
    })) as { id: number };
    const warningEvent = ctx.sqlite
      .prepare<{ payload: string }, []>(
        "SELECT payload FROM domain_events WHERE type = 'member.warned' ORDER BY id DESC LIMIT 1",
      )
      .get()!;
    expect(JSON.parse(warningEvent.payload)).toEqual({
      moderatorId: admin.kind === "guest" ? null : admin.userId,
      points: 1,
      reason: "Rule break",
      warningId: warning.id,
    });
    await dispatchEvents(ctx);
    expect(
      ctx.sqlite
        .prepare("SELECT id FROM user_promotions WHERE user_id = ?1 AND promotion_id = ?2")
        .all(author.id, warningRule.id),
    ).toHaveLength(0);
  });

  test("profile content, profile edits, and admin group events evaluate once", async () => {
    const ctx = createTestContext();
    const admin = userActor(insertUser(ctx, { groupId: 4 }));
    const poster = insertUser(ctx);
    const commenter = insertUser(ctx);
    const edited = insertUser(ctx);
    const changed = insertUser(ctx);
    const id = group(ctx);
    const hand = group(ctx, 20);
    const p = (await execute(ctx, op("create"), admin, {
      title: "Avatar",
      criteria: [{ criterion: "has_avatar", value: 1 }],
      groupIds: [id],
    })) as { id: number };
    registerPromotionJobs(ctx);
    for (const user of [poster, commenter, edited, changed])
      ctx.sqlite.prepare("UPDATE users SET avatar_file_id = 1 WHERE id = ?1").run(user.id);
    const post = (await execute(ctx, getOperation("profilePosts.create"), userActor(poster), {
      userId: poster.id,
      body: "Hello",
    })) as { id: number };
    await dispatchEvents(ctx);
    expect(
      ctx.sqlite.prepare("SELECT id FROM user_group_grants WHERE user_id = ?1").all(poster.id),
    ).toHaveLength(1);
    await execute(ctx, getOperation("profileComments.create"), userActor(commenter), {
      profilePostId: post.id,
      body: "Reply",
    });
    await dispatchEvents(ctx);
    expect(
      ctx.sqlite.prepare("SELECT id FROM user_group_grants WHERE user_id = ?1").all(commenter.id),
    ).toHaveLength(1);
    await execute(ctx, getOperation("profiles.update"), userActor(edited), { about: "Changed" });
    await dispatchEvents(ctx);
    expect(
      ctx.sqlite.prepare("SELECT id FROM user_group_grants WHERE user_id = ?1").all(edited.id),
    ).toHaveLength(1);
    await execute(ctx, getOperation("users.setGroups"), admin, {
      userId: changed.id,
      secondaryGroupIds: [hand],
    });
    await dispatchEvents(ctx);
    expect(
      ctx.sqlite.prepare("SELECT id FROM user_group_grants WHERE user_id = ?1").all(changed.id),
    ).toHaveLength(1);
    const count = () =>
      ctx.sqlite
        .prepare<{ n: number }, [number]>(
          "SELECT count(*) AS n FROM promotion_log WHERE promotion_id = ?1",
        )
        .get(p.id)!.n;
    const before = count();
    await dispatchEvents(ctx);
    expect(count()).toBe(before);
    writeTx(ctx, () =>
      publishEvent(ctx, {
        type: "member.groups_changed",
        targetType: "user",
        targetId: 999999,
        payload: { source: "admin", added: [], removed: [] },
      }),
    );
    await dispatchEvents(ctx);
    expect(count()).toBe(before);
  });

  test("deletion chunks survive retry and preserve hand groups", async () => {
    const ctx = createTestContext();
    const admin = userActor(insertUser(ctx, { groupId: 4 }));
    const hand = group(ctx);
    const granted = group(ctx, 25);
    const p = (await execute(ctx, op("create"), admin, {
      title: "Many",
      criteria: [{ criterion: "post_count", value: 1 }],
      groupIds: [hand, granted],
    })) as { id: number };
    let first = 0;
    for (let i = 0; i < 201; i++) {
      const userId = insertUser(ctx).id;
      if (i === 0) first = userId;
      ctx.sqlite
        .prepare(
          "INSERT INTO user_promotions (user_id, promotion_id, state, created_at, updated_at) VALUES (?1, ?2, 'auto', 0, 0)",
        )
        .run(userId, p.id);
      for (const groupId of [hand, granted])
        ctx.sqlite
          .prepare(
            "INSERT INTO user_group_grants (user_id, promotion_id, group_id, created_at) VALUES (?1, ?2, ?3, 0)",
          )
          .run(userId, p.id, groupId);
    }
    ctx.sqlite
      .prepare("INSERT INTO user_groups (user_id, group_id, created_at) VALUES (?1, ?2, 0)")
      .run(first, hand);
    registerPromotionJobs(ctx);
    await execute(ctx, op("delete"), admin, { promotionId: p.id });
    expect(ctx.sqlite.prepare("SELECT is_active FROM promotions WHERE id = ?1").get(p.id)).toEqual({
      is_active: 0,
    });
    expect(await runDueJobs(ctx, { limit: 1 })).toBe(1);
    deletePromotionChunk(ctx, {
      promotionId: p.id,
      after: 0,
      actorId: admin.kind === "guest" ? null : admin.userId,
    });
    await runDueJobs(ctx, { limit: 10 });
    expect(ctx.sqlite.prepare("SELECT id FROM promotions WHERE id = ?1").get(p.id)).toBeNull();
    expect(
      ctx.sqlite.prepare("SELECT group_id FROM user_groups WHERE user_id = ?1").get(first),
    ).toEqual({ group_id: hand });
    expect(
      ctx.sqlite
        .prepare<{ n: number }, [number]>(
          "SELECT count(*) AS n FROM promotion_log WHERE promotion_id = ?1 AND action = 'demote'",
        )
        .get(p.id)!.n,
    ).toBe(201);
    const event = ctx.sqlite
      .prepare<{ payload: string }, [number]>(
        "SELECT payload FROM domain_events WHERE type = 'member.groups_changed' AND target_id = ?1 ORDER BY id DESC LIMIT 1",
      )
      .get(first)!;
    expect(JSON.parse(event.payload)).toEqual({
      added: [],
      removed: [granted],
      source: "promotion",
      promotionId: p.id,
    });
  });
});
