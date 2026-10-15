import { afterEach, describe, expect, test } from "bun:test";
import { createTestContext, insertNode, insertUser, userActor } from "@sermo/core/testing";
import { closeContext } from "../../context";
import { writeTx } from "../../db/tx";
import { ConflictError } from "../../errors";
import { type DomainEvent, dispatchEvents, publishEvent } from "../../events";
import { execute } from "../../operation";
import { getOperation } from "../../operations";
import { moveCredits } from "../../shared/credits";
import { enqueueJob, registerJobHandler, runDueJobs } from "../jobs/queue";
import { evaluateMember, registerAwardJobs, SWEEP_CHUNK, sweepChunk } from "./automatic";

const contexts: ReturnType<typeof createTestContext>[] = [];
afterEach(() => {
  for (const ctx of contexts.splice(0)) closeContext(ctx);
});
function setup() {
  const ctx = createTestContext();
  contexts.push(ctx);
  const adminUser = insertUser(ctx, { groupId: 4 });
  const admin = userActor(adminUser);
  const member = insertUser(ctx);
  const call = (name: string, input: unknown = {}) =>
    execute(ctx, getOperation(`awards.${name}`), admin, input);
  registerAwardJobs(ctx);
  return { ctx, adminUser, member, call };
}
async function drainEvents(ctx: ReturnType<typeof createTestContext>) {
  for (let i = 0; i < 20; i++) if ((await dispatchEvents(ctx)) === 0) return;
  throw new Error("Award events did not terminate.");
}
const postRule = { match: "all", conditions: [{ criterion: "post_count", value: 1 }] };

describe("automatic awards", () => {
  test("credits events terminate, automatic grants survive lost eligibility and are never regranted", async () => {
    const { ctx, adminUser, member, call } = setup();
    const award = await call("create", {
      name: "Achievement",
      tier: "gold",
      xp: 5,
      credits: 10,
      isStackable: true,
      rule: postRule,
    });
    expect(evaluateMember(ctx, member.id)).toBe(0);
    ctx.sqlite.prepare("UPDATE users SET post_count = 1 WHERE id = ?1").run(member.id);
    expect(evaluateMember(ctx, member.id)).toBe(1);
    expect(evaluateMember(ctx, member.id)).toBe(0);
    await drainEvents(ctx);
    const grant = (await call("memberGrants", { userId: member.id })).items[0];
    expect(grant.grantedBy).toBeNull();
    expect(grant.reason).toBe("");
    ctx.sqlite.prepare("UPDATE users SET post_count = 0 WHERE id = ?1").run(member.id);
    expect(evaluateMember(ctx, member.id)).toBe(0);
    sweepChunk(ctx);
    expect((await call("member", { userId: member.id })).xp).toBe(5);
    ctx.sqlite.prepare("UPDATE users SET post_count = 1 WHERE id = ?1").run(member.id);
    await call("revoke", { memberAwardId: grant.id });
    await drainEvents(ctx);
    sweepChunk(ctx);
    ctx.sqlite
      .prepare("UPDATE event_subscribers SET last_event_id = 0 WHERE name = 'awards'")
      .run();
    await drainEvents(ctx);
    expect(await call("member", { userId: member.id })).toEqual({ xp: 0, items: [] });
    expect(
      ctx.sqlite
        .prepare(
          "SELECT count, auto_granted FROM member_award_totals WHERE user_id = ?1 AND award_id = ?2",
        )
        .get(member.id, award.id),
    ).toEqual({ count: 0, auto_granted: 1 });
    expect(
      ctx.sqlite
        .prepare(
          "SELECT amount, actor_id, type FROM credit_transactions WHERE user_id = ?1 ORDER BY id",
        )
        .all(member.id),
    ).toEqual([
      { amount: 10, actor_id: null, type: "award" },
      { amount: -10, actor_id: adminUser.id, type: "award_revoked" },
    ]);
  });

  test("stackable awards can be given manually plus once automatically; held non-stackable awards wait", async () => {
    const { ctx, member, call } = setup();
    ctx.sqlite.prepare("UPDATE users SET post_count = 1 WHERE id = ?1").run(member.id);
    for (const isStackable of [false, true]) {
      const award = await call("create", {
        name: "Manual and automatic",
        tier: "bronze",
        isStackable,
        rule: postRule,
      });
      const manual = await call("grant", { userId: member.id, awardId: award.id });
      expect(evaluateMember(ctx, member.id)).toBe(isStackable ? 1 : 0);
      expect(
        ctx.sqlite
          .prepare(
            "SELECT count, auto_granted FROM member_award_totals WHERE user_id = ?1 AND award_id = ?2",
          )
          .get(member.id, award.id),
      ).toEqual({ count: isStackable ? 2 : 1, auto_granted: isStackable ? 1 : 0 });
      await call("revoke", { memberAwardId: manual.id });
      expect(evaluateMember(ctx, member.id)).toBe(isStackable ? 0 : 1);
      expect(evaluateMember(ctx, member.id)).toBe(0);
    }
    expect(ctx.sqlite.prepare("SELECT id FROM credit_transactions").all()).toEqual([]);
  });

  test("inactive awards and empty criteria never grant automatically", async () => {
    const { ctx, member, call } = setup();
    ctx.sqlite.prepare("UPDATE users SET post_count = 1 WHERE id = ?1").run(member.id);
    await call("create", { name: "Manual only", tier: "bronze" });
    await call("create", {
      name: "Inactive",
      tier: "gold",
      rule: postRule,
      isActive: false,
    });
    expect(evaluateMember(ctx, member.id)).toBe(0);
    expect(evaluateMember(ctx, 999999)).toBe(0);
    sweepChunk(ctx);
    expect((await call("memberGrants", { userId: member.id })).items).toEqual([]);
  });

  test("credits paid by one award unlock another and each is paid only once", async () => {
    const { ctx, member, call } = setup();
    await call("create", {
      name: "Credits threshold",
      tier: "gold",
      credits: 5,
      rule: { match: "all", conditions: [{ criterion: "credits_at_least", value: 10 }] },
    });
    await call("create", { name: "Starter", tier: "bronze", credits: 10, rule: postRule });
    ctx.sqlite.prepare("UPDATE users SET post_count = 1 WHERE id = ?1").run(member.id);
    expect(evaluateMember(ctx, member.id)).toBe(1);
    await drainEvents(ctx);
    expect((await call("memberGrants", { userId: member.id })).items).toHaveLength(2);
    expect(ctx.sqlite.prepare("SELECT credits FROM users WHERE id = ?1").get(member.id)).toEqual({
      credits: 15,
    });
    sweepChunk(ctx);
    await drainEvents(ctx);
    expect(
      ctx.sqlite.prepare("SELECT id FROM credit_transactions WHERE user_id = ?1").all(member.id),
    ).toHaveLength(2);
  });

  for (const mode of ["event", "sweep"] as const) {
    test(`${mode} loads email verification, active warning points and all member facts`, async () => {
      const { ctx, adminUser, member, call } = setup();
      const award = await call("create", {
        name: "Facts",
        tier: "gold",
        rule: {
          match: "all",
          conditions: [
            { criterion: "post_count", value: 2 },
            { criterion: "days_registered", value: 5 },
            { criterion: "reaction_score", value: 3 },
            { criterion: "email_verified", value: 1 },
            { criterion: "has_avatar", value: 0 },
            { criterion: "active_within_days", value: 3 },
            { criterion: "inactive_days", value: 1 },
            { criterion: "warning_points_below", value: 3 },
            { criterion: "credits_at_least", value: 10 },
            { criterion: "credits_at_most", value: 10 },
            { criterion: "purchases_at_least", value: 4 },
          ],
        },
      });
      ctx.sqlite
        .prepare(
          "UPDATE users SET post_count = 2, reaction_score = 3, created_at = ?1, last_activity_at = ?2, shop_purchase_count = 4 WHERE id = ?3",
        )
        .run(ctx.now() - 6 * 86400000, ctx.now() - 2 * 86400000, member.id);
      writeTx(ctx, () => moveCredits(ctx, [{ userId: member.id, amount: 10, type: "adjustment" }]));
      const warn = ctx.sqlite.prepare(
        "INSERT INTO warnings (user_id, moderator_id, points, reason, created_at, expires_at) VALUES (?1, ?2, ?3, '', ?4, ?5)",
      );
      warn.run(member.id, adminUser.id, 2, ctx.now(), null);
      warn.run(member.id, adminUser.id, 100, ctx.now(), ctx.now());
      const active = Number(
        warn.run(member.id, adminUser.id, 2, ctx.now(), ctx.now() + 100).lastInsertRowid,
      );
      const evaluate = async () => {
        if (mode === "sweep") sweepChunk(ctx);
        else {
          writeTx(ctx, () =>
            publishEvent(ctx, {
              type: "content.edited",
              targetType: "profile",
              targetId: member.id,
            }),
          );
          await drainEvents(ctx);
        }
      };
      await evaluate();
      expect((await call("holders", { awardId: award.id })).items).toHaveLength(0);
      ctx.sqlite.prepare("UPDATE auth_user SET email_verified = 1 WHERE id = ?1").run(member.id);
      await evaluate();
      expect((await call("holders", { awardId: award.id })).items).toHaveLength(0);
      ctx.sqlite
        .prepare("UPDATE warnings SET expires_at = ?1 WHERE id = ?2")
        .run(ctx.now(), active);
      await evaluate();
      expect((await call("holders", { awardId: award.id })).items).toHaveLength(1);
    });
  }

  for (const mode of ["event", "sweep"] as const) {
    test(`${mode} attaches purchased items to the buyer, including gifts`, async () => {
      const { ctx, member, call } = setup();
      const recipient = insertUser(ctx);
      const category = Number(
        ctx.sqlite
          .prepare(
            "INSERT INTO shop_categories (name, created_at, updated_at) VALUES ('Gift', ?1, ?1)",
          )
          .run(ctx.now()).lastInsertRowid,
      );
      const item = Number(
        ctx.sqlite
          .prepare(
            'INSERT INTO shop_items (category_id, name, price, effect, created_at, updated_at) VALUES (?1, \'Gift\', 0, \'{"type":"frame","key":"gift"}\', ?2, ?2)',
          )
          .run(category, ctx.now()).lastInsertRowid,
      );
      const award = await call("create", {
        name: "Buyer",
        tier: "bronze",
        rule: { match: "all", conditions: [{ criterion: "purchased_item", value: item }] },
      });
      const purchase = Number(
        ctx.sqlite
          .prepare(
            "INSERT INTO shop_purchases (item_id, buyer_id, recipient_id, quantity, price, created_at) VALUES (?1, ?2, ?3, 1, 0, ?4)",
          )
          .run(item, member.id, recipient.id, ctx.now()).lastInsertRowid,
      );
      if (mode === "sweep") sweepChunk(ctx);
      else {
        writeTx(ctx, () =>
          publishEvent(ctx, {
            type: "shop.purchased",
            targetType: "shop_purchase",
            targetId: purchase,
            payload: {
              buyerId: member.id,
              recipientId: recipient.id,
              itemId: item,
              quantity: 1,
              price: 0,
            },
          }),
        );
        await drainEvents(ctx);
      }
      expect(
        (await call("holders", { awardId: award.id })).items.map(
          (grant: { user: { id: number } }) => grant.user.id,
        ),
      ).toEqual([member.id]);
      expect(evaluateMember(ctx, recipient.id)).toBe(0);
    });
  }

  for (const type of [
    "reaction.added",
    "member.warned",
    "content.edited",
    "member.groups_changed",
    "credits.changed",
  ] as const) {
    test(`subscriber evaluates the affected member after ${type}`, async () => {
      const { ctx, member, call } = setup();
      const award = await call("create", { name: type, tier: "bronze", rule: postRule });
      ctx.sqlite.prepare("UPDATE users SET post_count = 1 WHERE id = ?1").run(member.id);
      writeTx(ctx, () => {
        if (type === "credits.changed")
          moveCredits(ctx, [{ userId: member.id, amount: 1, type: "adjustment" }]);
        else
          publishEvent(ctx, {
            type,
            targetType: type === "content.edited" ? "profile" : "user",
            targetId: member.id,
            payload: { contentUserId: member.id, source: "admin" },
          });
      });
      await drainEvents(ctx);
      expect((await call("holders", { awardId: award.id })).items).toHaveLength(1);
    });
  }

  test("gaining a shop group evaluates the member", async () => {
    const { ctx, member, call } = setup();
    const rank = ctx.sqlite
      .prepare<{ id: number }, []>(
        "INSERT INTO groups (title, rank) VALUES ('Silver', 5) RETURNING id",
      )
      .get()!.id;
    const award = await call("create", {
      name: "Silver holder",
      tier: "bronze",
      rule: { match: "all", conditions: [{ criterion: "in_group", ids: [rank] }] },
    });
    ctx.sqlite
      .prepare(
        "INSERT INTO shop_group_grants (user_id, inventory_id, group_id, created_at) VALUES (?1, 1, ?2, 0)",
      )
      .run(member.id, rank);
    writeTx(ctx, () =>
      publishEvent(ctx, {
        type: "member.groups_changed",
        targetType: "user",
        targetId: member.id,
        payload: { added: [rank], removed: [], source: "shop" },
      }),
    );
    await drainEvents(ctx);
    expect((await call("holders", { awardId: award.id })).items).toHaveLength(1);
  });

  test("verifying an email evaluates the member", async () => {
    const { ctx, member, call } = setup();
    const award = await call("create", {
      name: "Verified",
      tier: "bronze",
      rule: { match: "all", conditions: [{ criterion: "email_verified", value: 1 }] },
    });
    const verify = async () => {
      writeTx(ctx, () =>
        publishEvent(ctx, {
          type: "member.groups_changed",
          targetType: "user",
          targetId: member.id,
          payload: { source: "verification" },
        }),
      );
      await drainEvents(ctx);
    };
    await verify();
    expect((await call("holders", { awardId: award.id })).items).toHaveLength(0);
    ctx.sqlite.prepare("UPDATE auth_user SET email_verified = 1 WHERE id = ?1").run(member.id);
    await verify();
    await verify();
    expect((await call("holders", { awardId: award.id })).items).toHaveLength(1);
  });

  test("subscriber ignores its own grant and revoke events and non-admin group changes", async () => {
    const { ctx, member, call } = setup();
    await call("create", { name: "Not yet", tier: "bronze", rule: postRule });
    ctx.sqlite.prepare("UPDATE users SET post_count = 1 WHERE id = ?1").run(member.id);
    for (const type of [
      "award.granted",
      "award.revoked",
      "member.groups_changed",
    ] satisfies DomainEvent["type"][])
      writeTx(ctx, () =>
        publishEvent(ctx, {
          type,
          targetType: "user",
          targetId: member.id,
          payload: { source: "promotion" },
        }),
      );
    await drainEvents(ctx);
    expect((await call("member", { userId: member.id })).items).toEqual([]);
  });

  for (const targetType of ["post", "thread", "profile_post", "profile_post_comment"]) {
    test(`content.created evaluates the author of a ${targetType}`, async () => {
      const { ctx, member, call } = setup();
      const wall = insertUser(ctx);
      const node = insertNode(ctx, {});
      const thread = Number(
        ctx.sqlite
          .prepare(
            "INSERT INTO threads (node_id, user_id, title, created_at, last_post_at, last_poster_id) VALUES (?1, ?2, 'Thread', ?3, ?3, ?2)",
          )
          .run(node.id, member.id, ctx.now()).lastInsertRowid,
      );
      const post = Number(
        ctx.sqlite
          .prepare(
            "INSERT INTO posts (thread_id, user_id, position, created_at) VALUES (?1, ?2, 0, ?3)",
          )
          .run(thread, member.id, ctx.now()).lastInsertRowid,
      );
      const profilePost = Number(
        ctx.sqlite
          .prepare(
            "INSERT INTO profile_posts (profile_user_id, user_id, body_source, body_html, created_at) VALUES (?1, ?2, '', '', ?3)",
          )
          .run(wall.id, member.id, ctx.now()).lastInsertRowid,
      );
      const comment = Number(
        ctx.sqlite
          .prepare(
            "INSERT INTO profile_post_comments (profile_post_id, user_id, body_source, body_html, created_at) VALUES (?1, ?2, '', '', ?3)",
          )
          .run(profilePost, member.id, ctx.now()).lastInsertRowid,
      );
      const targetId = { post, thread, profile_post: profilePost, profile_post_comment: comment }[
        targetType
      ]!;
      const award = await call("create", {
        name: "Author",
        tier: "bronze",
        rule: { match: "all", conditions: [{ criterion: "email_verified", value: 0 }] },
      });
      writeTx(ctx, () => publishEvent(ctx, { type: "content.created", targetType, targetId }));
      await drainEvents(ctx);
      expect(
        (await call("holders", { awardId: award.id })).items.map(
          (grant: { user: { id: number } }) => grant.user.id,
        ),
      ).toEqual([member.id]);
      writeTx(ctx, () =>
        publishEvent(ctx, { type: "content.created", targetType, targetId: 999999 }),
      );
      await drainEvents(ctx);
      expect((await call("get", { awardId: award.id })).grantCount).toBe(1);
    });
  }
});

describe("award sweeps", () => {
  test("resumes by member id and a repeated run of a claimed chunk does nothing", async () => {
    const { ctx, call } = setup();
    const ids: number[] = [];
    for (let i = 0; i < SWEEP_CHUNK * 2 + 7; i++) ids.push(insertUser(ctx).id);
    ctx.sqlite
      .prepare("UPDATE users SET post_count = 1 WHERE id IN (SELECT value FROM json_each(?1))")
      .run(JSON.stringify(ids));
    const award = await call("create", {
      name: "Sweep",
      tier: "silver",
      xp: 2,
      credits: 3,
      rule: postRule,
    });
    const progress: number[] = [];
    registerJobHandler(ctx, "awards.sweep", (context, payload, job) => {
      const after = (payload as { after: number }).after;
      progress.push(after);
      const length = sweepChunk(context, after, job);
      expect(length).toBeGreaterThan(0);
      // A repeated run of the same claim is stale: it does nothing.
      expect(sweepChunk(context, after, job)).toBe(0);
    });
    await call("run");
    expect(await runDueJobs(ctx, { limit: 1 })).toBe(1);
    expect(progress).toEqual([0]);
    expect(
      ctx.sqlite.prepare("SELECT payload FROM jobs WHERE unique_key = 'awards.sweep'").get(),
    ).toEqual({ payload: JSON.stringify({ after: SWEEP_CHUNK }) });
    while (await runDueJobs(ctx, { limit: 1 })) {}
    expect(progress).toEqual([0, SWEEP_CHUNK, SWEEP_CHUNK * 2]);
    expect((await call("get", { awardId: award.id })).grantCount).toBe(ids.length);
    expect(
      ctx.sqlite
        .prepare(
          "SELECT user_id, count, auto_granted FROM member_award_totals WHERE award_id = ?1 ORDER BY user_id",
        )
        .all(award.id),
    ).toEqual(ids.map((id) => ({ user_id: id, count: 1, auto_granted: 1 })));
    await call("run");
    while (await runDueJobs(ctx, { limit: 1 })) {}
    await drainEvents(ctx);
    expect((await call("get", { awardId: award.id })).grantCount).toBe(ids.length);
    expect(
      ctx.sqlite.prepare("SELECT credits, award_xp FROM users WHERE id = ?1").get(ids[0]!),
    ).toEqual({ credits: 3, award_xp: 2 });
    expect(ctx.sqlite.prepare("SELECT id FROM jobs WHERE status = 'failed'").all()).toEqual([]);
  });

  test("a retried predecessor does not release or duplicate its successor", async () => {
    const { ctx, call } = setup();
    for (let i = 0; i < SWEEP_CHUNK; i++) insertUser(ctx);
    const award = await call("create", { name: "Sweep", tier: "bronze", rule: postRule });
    ctx.sqlite.prepare("UPDATE users SET post_count = 1").run();
    const first = Number(
      enqueueJob(ctx, "awards.sweep", { after: 0 }, { uniqueKey: "awards.sweep" }),
    );
    const lease = ctx.now() + 1000;
    ctx.sqlite
      .prepare("UPDATE jobs SET status = 'running', locked_until = ?1 WHERE id = ?2")
      .run(lease, first);
    expect(sweepChunk(ctx, 0, { id: first, lockedUntil: lease })).toBe(SWEEP_CHUNK);
    const successor = ctx.sqlite
      .prepare("SELECT id FROM jobs WHERE unique_key = 'awards.sweep' AND status = 'pending'")
      .get() as { id: number };
    ctx.sqlite
      .prepare("UPDATE jobs SET status = 'running', locked_until = ?1 WHERE id = ?2")
      .run(lease, successor.id);
    // The first run's lease expires and the queue hands it out again with a new lease.
    ctx.sqlite
      .prepare("UPDATE jobs SET status = 'running', locked_until = ?1 WHERE id = ?2")
      .run(lease + 1000, first);
    const granted = (await call("get", { awardId: award.id })).grantCount;
    expect(sweepChunk(ctx, 0, { id: first, lockedUntil: lease })).toBe(0);
    expect(
      ctx.sqlite.prepare("SELECT id, status FROM jobs WHERE unique_key IS NOT NULL").all(),
    ).toEqual([{ id: successor.id, status: "running" }]);
    expect(
      ctx.sqlite
        .prepare("SELECT count(*) AS n FROM jobs WHERE type = 'awards.sweep' AND id > ?1")
        .get(successor.id),
    ).toEqual({ n: 0 });
    expect((await call("get", { awardId: award.id })).grantCount).toBe(granted);
  });

  test("a stale claim grants nothing and queues nothing", async () => {
    const { ctx, member, call } = setup();
    ctx.sqlite.prepare("UPDATE users SET post_count = 1").run();
    const award = await call("create", { name: "Sweep", tier: "bronze", rule: postRule });
    const id = Number(enqueueJob(ctx, "awards.sweep", { after: 0 }, { uniqueKey: "awards.sweep" }));
    ctx.sqlite
      .prepare("UPDATE jobs SET status = 'running', locked_until = ?1 WHERE id = ?2")
      .run(ctx.now() + 2000, id);
    expect(sweepChunk(ctx, 0, { id, lockedUntil: ctx.now() + 1000 })).toBe(0);
    expect((await call("get", { awardId: award.id })).grantCount).toBe(0);
    expect(ctx.sqlite.prepare("SELECT count(*) AS n FROM jobs").get()).toEqual({ n: 1 });
    expect(member.id).toBeGreaterThan(0);
  });

  test("a full queued sweep visits every member once and leaves no sweep job pending", async () => {
    const { ctx, call } = setup();
    for (let i = 0; i < SWEEP_CHUNK * 2 + 7; i++) insertUser(ctx);
    ctx.sqlite.prepare("UPDATE users SET post_count = 1").run();
    const award = await call("create", { name: "Sweep", tier: "bronze", rule: postRule });
    const total = (ctx.sqlite.prepare("SELECT count(*) AS n FROM users").get() as { n: number }).n;
    let visited = 0;
    registerJobHandler(ctx, "awards.sweep", (context, payload, job) => {
      visited += sweepChunk(context, (payload as { after: number }).after, job);
    });
    await call("run");
    while (await runDueJobs(ctx, { limit: 1 })) {}
    expect(visited).toBe(total);
    expect((await call("get", { awardId: award.id })).grantCount).toBe(total);
    expect(
      ctx.sqlite
        .prepare(
          "SELECT id FROM jobs WHERE type = 'awards.sweep' AND status IN ('pending', 'running')",
        )
        .all(),
    ).toEqual([]);
  });

  test("a chunk rolls back all earlier grants if a later credit movement fails", async () => {
    const { ctx, member, call } = setup();
    const later = insertUser(ctx);
    ctx.sqlite
      .prepare("UPDATE users SET post_count = 1 WHERE id IN (?1, ?2)")
      .run(member.id, later.id);
    writeTx(ctx, () =>
      moveCredits(ctx, [{ userId: later.id, amount: Number.MAX_SAFE_INTEGER, type: "adjustment" }]),
    );
    const award = await call("create", {
      name: "Rollback",
      tier: "bronze",
      credits: 1,
      rule: postRule,
    });
    expect(() => sweepChunk(ctx)).toThrow(ConflictError);
    expect((await call("get", { awardId: award.id })).grantCount).toBe(0);
    expect(ctx.sqlite.prepare("SELECT id FROM member_award_totals").all()).toEqual([]);
    expect(ctx.sqlite.prepare("SELECT id FROM member_awards").all()).toEqual([]);
    for (const invalid of [-1, 0.5, Number.NaN])
      expect(() => sweepChunk(ctx, invalid)).toThrow(TypeError);
  });
});
