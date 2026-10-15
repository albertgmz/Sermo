import { describe, expect, test } from "bun:test";
import { writeTx } from "../../db/tx";
import { type DomainEvent, dispatchEvents, publishEvent } from "../../events";
import { registerAwardJobs } from "../../modules/awards/automatic";
import { registerPromotionJobs } from "../../modules/promotions";
import { execute } from "../../operation";
import { getOperation } from "../../operations";
import { createTestContext, insertNode, insertUser, userActor } from "../../testing";
import { everyone, isRefreshedBy, membersAffected, type Rule } from "../criteria";

const rule = (...conditions: Rule["conditions"]): Rule => ({ match: "all", conditions });

function world() {
  const ctx = createTestContext();
  const admin = userActor(insertUser(ctx, { groupId: 4 }));
  const author = insertUser(ctx);
  const replier = insertUser(ctx);
  const node = insertNode(ctx, {}).id;
  registerAwardJobs(ctx);
  registerPromotionJobs(ctx);
  const thread = ctx.sqlite
    .prepare<{ id: number }, [number, number]>(
      "INSERT INTO threads (node_id, user_id, title, created_at, last_post_at, last_poster_id, reply_count) VALUES (?1, ?2, 'T', 1, 1, ?2, 0) RETURNING id",
    )
    .get(node, author.id)!.id;
  const post = (userId: number, position: number) =>
    ctx.sqlite
      .prepare<{ id: number }, [number, number, number]>(
        "INSERT INTO posts (thread_id, user_id, position, created_at) VALUES (?1, ?2, ?3, 1) RETURNING id",
      )
      .get(thread, userId, position)!.id;
  return { ctx, admin, author, replier, thread, post };
}

describe("events that change a criterion's fact", () => {
  test("a reply tells the thread's author, a gift tells its recipient, a spent item its owner", () => {
    const { ctx, author, replier, post } = world();
    const replies = rule({ criterion: "replies_received", value: 1 });
    const owns = rule({ criterion: "owns_item", ids: [1] });
    const reply = {
      id: 1,
      type: "content.created",
      targetType: "post",
      targetId: post(replier.id, 1),
      payload: {},
      createdAt: 0,
    } as const;
    expect(membersAffected(ctx, reply, [replies])).toEqual([author.id]);
    // Not when no rule reads the fact, nor for content that is not a post.
    expect(membersAffected(ctx, reply, [owns, everyone()])).toEqual([]);
    expect(membersAffected(ctx, { ...reply, targetType: "profile_post" }, [replies])).toEqual([]);
    expect(isRefreshedBy(reply)).toBe(true);
    const gift = {
      id: 2,
      type: "shop.purchased",
      targetType: "shop_purchase",
      targetId: 1,
      payload: { buyerId: author.id, recipientId: replier.id },
      createdAt: 0,
    } as const;
    expect(membersAffected(ctx, gift, [owns])).toEqual([replier.id]);
    const used = {
      id: 3,
      type: "shop.item_used",
      targetType: "shop_inventory",
      targetId: 1,
      payload: { userId: author.id },
      createdAt: 0,
    } as const;
    expect(membersAffected(ctx, used, [owns])).toEqual([author.id]);
    expect(membersAffected(ctx, used, [replies])).toEqual([]);
    expect(isRefreshedBy({ ...used, type: "member.followed" })).toBe(false);
  });

  test("a restriction, a ban or a thread ban tells the member, a resolved report its reporters", () => {
    const { ctx, author, replier } = world();
    const group = ctx.sqlite
      .prepare<{ id: number }, []>(
        "INSERT INTO report_groups (target_type, target_id, state, report_count, created_at, updated_at) VALUES ('post', 1, 'resolved', 2, 1, 1) RETURNING id",
      )
      .get()!.id;
    for (const reporter of [author.id, replier.id])
      ctx.sqlite
        .prepare(
          "INSERT INTO reports (group_id, reporter_id, reason, created_at) VALUES (?1, ?2, 'r', 1)",
        )
        .run(group, reporter);
    const event = (type: DomainEvent["type"], targetId: number, payload = {}) =>
      ({ id: 1, type, targetType: "user", targetId, payload, createdAt: 0 }) as DomainEvent;
    const asks = (event: DomainEvent, ...conditions: Rule["conditions"]) =>
      membersAffected(ctx, event, [rule(...conditions)]);
    expect(
      asks(event("member.restricted", replier.id), { criterion: "restricted_posting", value: 1 }),
    ).toEqual([replier.id]);
    expect(
      asks(event("member.thread_banned", replier.id), { criterion: "thread_banned", value: 1 }),
    ).toEqual([replier.id]);
    expect(
      asks(event("member.banned", replier.id), { criterion: "banned_before", value: 1 }),
    ).toEqual([replier.id]);
    // A ban says nothing about a restriction.
    expect(
      asks(event("member.banned", replier.id), { criterion: "restricted_posting", value: 1 }),
    ).toEqual([]);
    const resolved = event("report.state_changed", group, { state: "resolved" });
    expect(asks(resolved, { criterion: "reports_resolved", value: 1 }).sort()).toEqual(
      [author.id, replier.id].sort(),
    );
    expect(
      asks(event("report.state_changed", group, { state: "rejected" }), {
        criterion: "reports_resolved",
        value: 1,
      }),
    ).toEqual([]);
  });

  test("new or edited content tells the members it mentions", () => {
    const { ctx, author, replier, post } = world();
    const mentioning = post(author.id, 1);
    ctx.sqlite
      .prepare(
        "INSERT INTO content_mentions (content_type, content_id, user_id, created_at) VALUES ('post', ?1, ?2, 1)",
      )
      .run(mentioning, replier.id);
    const created = {
      id: 1,
      type: "content.created",
      targetType: "post",
      targetId: mentioning,
      payload: {},
      createdAt: 0,
    } as const;
    const mentions = rule({ criterion: "mentioned_by_others", value: 1 });
    expect(membersAffected(ctx, created, [mentions])).toEqual([replier.id]);
    expect(membersAffected(ctx, { ...created, type: "content.edited" }, [mentions])).toEqual([
      replier.id,
    ]);
    expect(membersAffected(ctx, { ...created, targetType: "thread" }, [mentions])).toEqual([]);
  });

  test("an award is given to the thread's author as soon as a reply makes the rule hold", async () => {
    const { ctx, admin, author, replier, thread, post } = world();
    const created = (await execute(ctx, getOperation("awards.create"), admin, {
      name: "Talked about",
      tier: "bronze",
      rule: rule({ criterion: "replies_received", value: 1 }),
    })) as { id: number };
    const postId = post(replier.id, 1);
    ctx.sqlite.prepare("UPDATE threads SET reply_count = 1 WHERE id = ?1").run(thread);
    writeTx(ctx, () =>
      publishEvent(ctx, { type: "content.created", targetType: "post", targetId: postId }),
    );
    for (let i = 0; i < 5; i++) await dispatchEvents(ctx);
    const holders = ctx.sqlite
      .prepare<{ user_id: number }, [number]>(
        "SELECT user_id FROM member_awards WHERE award_id = ?1 AND revoked_at IS NULL",
      )
      .all(created.id);
    expect(holders.map((row) => row.user_id)).toEqual([author.id]);
  });

  test("a promotion follows the same events", async () => {
    const { ctx, admin, replier } = world();
    const badge = ctx.sqlite
      .prepare<{ id: number }, []>(
        "INSERT INTO groups (title, rank) VALUES ('Badge', 30) RETURNING id",
      )
      .get()!.id;
    ctx.sqlite
      .prepare("INSERT INTO shop_categories (name, created_at, updated_at) VALUES ('C', 0, 0)")
      .run();
    const item = ctx.sqlite
      .prepare<{ id: number }, []>(
        "INSERT INTO shop_items (category_id, name, price, effect, created_at, updated_at) VALUES (1, 'I', 1, '{\"type\":\"bump\"}', 0, 0) RETURNING id",
      )
      .get()!.id;
    await execute(ctx, getOperation("promotions.create"), admin, {
      title: "Owners",
      rule: rule({ criterion: "owns_item", ids: [item], mode: "one" }),
      groupIds: [badge],
    });
    ctx.sqlite
      .prepare(
        "INSERT INTO shop_inventory (user_id, item_id, state, acquired_at, updated_at) VALUES (?1, ?2, 'active', 0, 0)",
      )
      .run(replier.id, item);
    writeTx(ctx, () =>
      publishEvent(ctx, {
        type: "shop.purchased",
        targetType: "shop_purchase",
        targetId: 1,
        payload: { buyerId: 0, recipientId: replier.id },
      }),
    );
    for (let i = 0; i < 5; i++) await dispatchEvents(ctx);
    const granted = ctx.sqlite
      .prepare<{ group_id: number }, [number]>(
        "SELECT group_id FROM user_group_grants WHERE user_id = ?1",
      )
      .all(replier.id);
    expect(granted.map((row) => row.group_id)).toEqual([badge]);
  });
});
