import { describe, expect, test } from "bun:test";
import type { Ctx } from "../../context";
import { ValidationError } from "../../errors";
import { createTestContext, expectNoTableScan, insertNode, insertUser } from "../../testing";
import {
  assertRule,
  type Condition,
  criteriaMeasures,
  criterionDefinitions,
  evaluate,
  loadFacts,
  measureSlots,
  type Rule,
} from "../criteria";

/**
 * Every measured criterion against real rows: what its statement counts, who it holds for, and
 * the edge. `member` has the rows the condition asks for, `other` has none of them.
 */

const rule = (...conditions: Condition[]): Rule => ({ match: "all", conditions });

/** Whether a rule holds for each member, loaded the way a consumer loads them. */
function holdsFor(ctx: Ctx, memberIds: number[], condition: Condition): boolean[] {
  const only = rule(condition);
  const facts = loadFacts(ctx, memberIds, [only]);
  return memberIds.map((id) => evaluate(only, facts.get(id)!));
}

function insertRow(ctx: Ctx, sql: string, ...params: (string | number | null)[]): number {
  return ctx.sqlite
    .prepare<{ id: number }, (string | number | null)[]>(`${sql} RETURNING id`)
    .get(...params)!.id;
}

function thread(ctx: Ctx, userId: number, nodeId: number, replies = 0, state = "visible") {
  return insertRow(
    ctx,
    "INSERT INTO threads (node_id, user_id, title, state, created_at, last_post_at, last_poster_id, reply_count) VALUES (?1, ?2, 'T', ?3, 1, 1, ?2, ?4)",
    nodeId,
    userId,
    state,
    replies,
  );
}

let position = 0;
function post(ctx: Ctx, threadId: number, userId: number, state = "visible") {
  position += 1;
  return insertRow(
    ctx,
    "INSERT INTO posts (thread_id, user_id, position, state, created_at) VALUES (?1, ?2, ?3, ?4, 1)",
    threadId,
    userId,
    position,
    state,
  );
}

function world() {
  const ctx = createTestContext();
  const member = insertUser(ctx).id;
  const other = insertUser(ctx).id;
  const node = insertNode(ctx, {}).id;
  return { ctx, member, other, node };
}

describe("content criteria", () => {
  test("posts_in_threads counts visible posts per thread, in each, one and all mode", () => {
    const { ctx, member, other, node } = world();
    const [a, b, c] = [
      thread(ctx, other, node),
      thread(ctx, other, node),
      thread(ctx, other, node),
    ];
    for (let n = 0; n < 3; n++) post(ctx, a, member);
    post(ctx, b, member);
    post(ctx, b, member, "deleted");
    post(ctx, b, member, "moderated");
    post(ctx, a, other);
    const asks = (mode: "each" | "one" | "all", value: number, ids = [a, b]) =>
      holdsFor(ctx, [member, other], { criterion: "posts_in_threads", ids, value, mode });
    expect(asks("each", 1)).toEqual([true, false]);
    expect(asks("each", 3)).toEqual([false, false]);
    expect(asks("one", 3)).toEqual([true, false]);
    expect(asks("one", 4)).toEqual([false, false]);
    expect(asks("all", 4)).toEqual([true, false]);
    expect(asks("all", 5)).toEqual([false, false]);
    // A thread the member never posted in.
    expect(asks("each", 1, [a, b, c])).toEqual([false, false]);
    expect(asks("each", 3, [a])).toEqual([true, false]);
  });

  test("replies_received sums the replies of the member's visible threads", () => {
    const { ctx, member, other, node } = world();
    thread(ctx, member, node, 4);
    thread(ctx, member, node, 6);
    thread(ctx, member, node, 50, "deleted");
    thread(ctx, other, node, 99);
    const asks = (value: number) =>
      holdsFor(ctx, [member, other], { criterion: "replies_received", value });
    expect(asks(10)).toEqual([true, true]);
    expect(asks(11)).toEqual([false, true]);
    expect(holdsFor(ctx, [member], { criterion: "busiest_thread_replies", value: 6 })).toEqual([
      true,
    ]);
    expect(holdsFor(ctx, [member], { criterion: "busiest_thread_replies", value: 7 })).toEqual([
      false,
    ]);
  });

  test("replies_received and busiest_thread_replies of a member with no thread", () => {
    const { ctx, member } = world();
    expect(holdsFor(ctx, [member], { criterion: "replies_received", value: 1 })).toEqual([false]);
    expect(holdsFor(ctx, [member], { criterion: "busiest_thread_replies", value: 0 })).toEqual([
      true,
    ]);
  });

  test("profile posts and comments written count the visible ones the member wrote", () => {
    const { ctx, member, other } = world();
    const wall = (author: number, state = "visible") =>
      insertRow(
        ctx,
        "INSERT INTO profile_posts (profile_user_id, user_id, state, created_at, body_source, body_html) VALUES (?1, ?2, ?3, 1, 'b', 'b')",
        other,
        author,
        state,
      );
    const first = wall(member);
    wall(member);
    wall(member, "deleted");
    wall(other);
    const comment = (author: number, state = "visible") =>
      insertRow(
        ctx,
        "INSERT INTO profile_post_comments (profile_post_id, user_id, state, created_at, body_source, body_html) VALUES (?1, ?2, ?3, 1, 'b', 'b')",
        first,
        author,
        state,
      );
    comment(member);
    comment(member, "moderated");
    comment(other);
    const posts = (value: number) =>
      holdsFor(ctx, [member, other], { criterion: "profile_posts_written", value });
    expect(posts(2)).toEqual([true, false]);
    expect(posts(3)).toEqual([false, false]);
    expect(posts(1)).toEqual([true, true]);
    const comments = (value: number) =>
      holdsFor(ctx, [member, other], { criterion: "profile_comments_written", value });
    expect(comments(1)).toEqual([true, true]);
    expect(comments(2)).toEqual([false, false]);
  });

  test("attachments_uploaded counts the member's attached attachment files", () => {
    const { ctx, member, other } = world();
    const file = (uploader: number, purpose: string, visibility: string, deleted: number | null) =>
      insertRow(
        ctx,
        "INSERT INTO files (driver, storage_key, byte_size, content_type, sha256, uploader_id, purpose, visibility, created_at, deleted_at) VALUES ('d', ?1, 1, 'text/plain', 'x', ?2, ?3, ?4, 1, ?5)",
        `k${Math.random()}`,
        uploader,
        purpose,
        visibility,
        deleted,
      );
    file(member, "attachment", "public", null);
    file(member, "attachment", "private", null);
    file(member, "attachment", "unattached", null);
    file(member, "attachment", "public", 5);
    file(member, "avatar", "public", null);
    file(other, "attachment", "public", null);
    const asks = (value: number) =>
      holdsFor(ctx, [member, other], { criterion: "attachments_uploaded", value });
    expect(asks(2)).toEqual([true, false]);
    expect(asks(3)).toEqual([false, false]);
  });

  test("bookmarks, watched forums and watched threads count the member's rows", () => {
    const { ctx, member, other, node } = world();
    const second = insertNode(ctx, {}).id;
    const t1 = thread(ctx, other, node);
    const t2 = thread(ctx, other, node);
    for (const id of [t1, t2])
      insertRow(
        ctx,
        "INSERT INTO bookmarks (user_id, content_type, content_id, created_at) VALUES (?1, 'thread', ?2, 1)",
        member,
        id,
      );
    for (const id of [node, second])
      insertRow(
        ctx,
        "INSERT INTO node_watches (user_id, node_id, mode, created_at) VALUES (?1, ?2, 'threads', 1)",
        member,
        id,
      );
    insertRow(
      ctx,
      "INSERT INTO thread_watches (user_id, thread_id, created_at) VALUES (?1, ?2, 1)",
      member,
      t1,
    );
    const asks = (criterion: string, value: number) =>
      holdsFor(ctx, [member, other], { criterion, value });
    expect(asks("bookmarks_at_least", 2)).toEqual([true, false]);
    expect(asks("bookmarks_at_least", 3)).toEqual([false, false]);
    expect(asks("watching_forums_at_least", 2)).toEqual([true, false]);
    expect(asks("watching_forums_at_least", 3)).toEqual([false, false]);
    expect(asks("watching_threads_at_least", 1)).toEqual([true, false]);
    expect(asks("watching_threads_at_least", 2)).toEqual([false, false]);
  });
});

function category(ctx: Ctx) {
  return insertRow(
    ctx,
    "INSERT INTO shop_categories (name, created_at, updated_at) VALUES ('Cat', 0, 0)",
  );
}
function item(ctx: Ctx, categoryId: number, effect: object = { type: "bump" }) {
  return insertRow(
    ctx,
    "INSERT INTO shop_items (category_id, name, price, effect, created_at, updated_at) VALUES (?1, 'Item', 5, ?2, 0, 0)",
    categoryId,
    JSON.stringify(effect),
  );
}
function holding(ctx: Ctx, userId: number, itemId: number, state: string, expiresAt?: number) {
  insertRow(
    ctx,
    "INSERT INTO shop_inventory (user_id, item_id, state, expires_at, acquired_at, updated_at) VALUES (?1, ?2, ?3, ?4, 0, 0)",
    userId,
    itemId,
    state,
    expiresAt ?? null,
  );
}
function purchase(ctx: Ctx, buyer: number, itemId: number, recipient = buyer, quantity = 1) {
  insertRow(
    ctx,
    "INSERT INTO shop_purchases (item_id, buyer_id, recipient_id, quantity, price, created_at) VALUES (?1, ?2, ?3, ?4, 5, 0)",
    itemId,
    buyer,
    recipient,
    quantity,
  );
}

describe("economy criteria", () => {
  test("owns_item holds for an item in effect or a consumable with units left, not a spent one", () => {
    const { ctx, member, other } = world();
    const cat = category(ctx);
    const [active, unused, used, expired, late, never] = Array.from({ length: 6 }, () =>
      item(ctx, cat),
    ) as [number, number, number, number, number, number];
    holding(ctx, member, active, "active");
    holding(ctx, member, unused, "unused");
    holding(ctx, member, used, "used");
    holding(ctx, member, expired, "expired");
    holding(ctx, member, late, "active", ctx.now() - 1);
    holding(ctx, other, never, "active");
    const asks = (ids: number[], mode: "one" | "each") =>
      holdsFor(ctx, [member, other], { criterion: "owns_item", ids, mode });
    expect(asks([active], "one")).toEqual([true, false]);
    expect(asks([unused], "one")).toEqual([true, false]);
    expect(asks([used, expired, late], "one")).toEqual([false, false]);
    expect(asks([active, unused], "each")).toEqual([true, false]);
    expect(asks([active, used], "each")).toEqual([false, false]);
    expect(asks([active, used], "one")).toEqual([true, false]);
    expect(asks([never], "one")).toEqual([false, true]);
  });

  test("wears_item holds when the frame, name color or name icon the item gives is chosen", () => {
    const { ctx, member, other } = world();
    const cat = category(ctx);
    const frame = item(ctx, cat, { type: "frame", frameId: 11 });
    const color = item(ctx, cat, { type: "nameColor", colorId: 12 });
    const icon = item(ctx, cat, { type: "nameIcon", icon: "star", position: "before" });
    const spare = item(ctx, cat, { type: "frame", frameId: 13 });
    for (const id of [frame, color, icon, spare]) holding(ctx, member, id, "active");
    ctx.sqlite
      .prepare(
        "UPDATE users SET frame_id = 11, name_color_id = 12, name_icon_item_id = ?2 WHERE id = ?1",
      )
      .run(member, icon);
    // The other member has the same frame chosen but never bought the item.
    ctx.sqlite.prepare("UPDATE users SET frame_id = 11 WHERE id = ?1").run(other);
    const asks = (ids: number[], mode: "one" | "each") =>
      holdsFor(ctx, [member, other], { criterion: "wears_item", ids, mode });
    expect(asks([frame], "one")).toEqual([true, false]);
    expect(asks([color], "one")).toEqual([true, false]);
    expect(asks([icon], "one")).toEqual([true, false]);
    // Owned but not the one chosen.
    expect(asks([spare], "one")).toEqual([false, false]);
    expect(asks([frame, color, icon], "each")).toEqual([true, false]);
    expect(asks([frame, spare], "each")).toEqual([false, false]);
    // An expired purchase no longer counts as worn.
    ctx.sqlite
      .prepare("UPDATE shop_inventory SET state = 'expired' WHERE user_id = ?1 AND item_id = ?2")
      .run(member, frame);
    expect(asks([frame], "one")).toEqual([false, false]);
  });

  test("bought_in_category holds for a purchase in the category, a gift included", () => {
    const { ctx, member, other } = world();
    const [c1, c2, c3] = [category(ctx), category(ctx), category(ctx)];
    const [i1, i2] = [item(ctx, c1), item(ctx, c2)];
    purchase(ctx, member, i1);
    purchase(ctx, member, i2, other);
    purchase(ctx, other, i1, member);
    const asks = (ids: number[], mode: "one" | "each") =>
      holdsFor(ctx, [member, other], { criterion: "bought_in_category", ids, mode });
    expect(asks([c1], "one")).toEqual([true, true]);
    expect(asks([c2], "one")).toEqual([true, false]);
    expect(asks([c3], "one")).toEqual([false, false]);
    expect(asks([c1, c2], "each")).toEqual([true, false]);
    expect(asks([c1, c3], "one")).toEqual([true, true]);
    expect(asks([c1, c3], "each")).toEqual([false, false]);
  });

  test("gifted_items sums the units the member paid for that went to someone else", () => {
    const { ctx, member, other } = world();
    const i1 = item(ctx, category(ctx));
    purchase(ctx, member, i1, other, 2);
    purchase(ctx, member, i1, other, 1);
    purchase(ctx, member, i1);
    purchase(ctx, other, i1, member, 9);
    const asks = (value: number) =>
      holdsFor(ctx, [member, other], { criterion: "gifted_items", value });
    expect(asks(3)).toEqual([true, true]);
    expect(asks(4)).toEqual([false, true]);
    expect(asks(10)).toEqual([false, false]);
  });

  test("credits_earned is the net of rules and awards, in all time or a window", () => {
    const { ctx, member, other } = world();
    const ago = (days: number) => ctx.now() - days * 86_400_000;
    const ledger = (userId: number, amount: number, type: string, at: number) =>
      insertRow(
        ctx,
        "INSERT INTO credit_transactions (user_id, amount, balance_after, type, created_at) VALUES (?1, ?2, 0, ?3, ?4)",
        userId,
        amount,
        type,
        at,
      );
    ledger(member, 30, "event", ago(40));
    ledger(member, 20, "award", ago(3));
    ledger(member, 10, "event", ago(7));
    ledger(member, -4, "event_reversal", ago(1));
    ledger(member, -2, "award_revoked", ago(1));
    ledger(member, 500, "adjustment", ago(1));
    ledger(member, -50, "purchase", ago(1));
    ledger(other, 5, "event", ago(1));
    const asks = (value: number, days?: number) =>
      holdsFor(ctx, [member, other], {
        criterion: "credits_earned",
        value,
        ...(days === undefined ? {} : { days }),
      });
    expect(asks(54)).toEqual([true, false]);
    expect(asks(55)).toEqual([false, false]);
    // Seven days back includes the row exactly seven days old.
    expect(asks(24, 7)).toEqual([true, false]);
    expect(asks(25, 7)).toEqual([false, false]);
    expect(asks(24, 6)).toEqual([false, false]);
    expect(asks(14, 6)).toEqual([true, false]);
  });

  test("credits_from_rule sums the applied credits of the chosen rules", () => {
    const { ctx, member, other } = world();
    const ago = (days: number) => ctx.now() - days * 86_400_000;
    let source = 0;
    const applied = (
      userId: number,
      rule: number,
      amount: number,
      at: number,
      state = "applied",
    ) => {
      source += 1;
      return insertRow(
        ctx,
        "INSERT INTO credit_rule_applications (rule_id, user_id, source_type, source_id, amount, state, created_at) VALUES (?1, ?2, 'post', ?3, ?4, ?5, ?6)",
        rule,
        userId,
        source,
        amount,
        state,
        at,
      );
    };
    applied(member, 1, 10, ago(40));
    applied(member, 1, 5, ago(2));
    applied(member, 2, 7, ago(2));
    applied(member, 2, 100, ago(2), "reverted");
    applied(member, 3, 50, ago(2));
    applied(other, 1, 3, ago(2));
    const asks = (condition: Omit<Condition, "criterion">) =>
      holdsFor(ctx, [member, other], { criterion: "credits_from_rule", ...condition });
    expect(asks({ ids: [1], value: 15, mode: "one" })).toEqual([true, false]);
    expect(asks({ ids: [1], value: 16, mode: "one" })).toEqual([false, false]);
    expect(asks({ ids: [1, 2], value: 22, mode: "all" })).toEqual([true, false]);
    expect(asks({ ids: [1, 2], value: 23, mode: "all" })).toEqual([false, false]);
    expect(asks({ ids: [1, 2], value: 7, mode: "each" })).toEqual([true, false]);
    expect(asks({ ids: [1, 2], value: 8, mode: "each" })).toEqual([false, false]);
    // A window leaves out the old application of rule 1.
    expect(asks({ ids: [1], value: 5, days: 30, mode: "one" })).toEqual([true, false]);
    expect(asks({ ids: [1], value: 6, days: 30, mode: "one" })).toEqual([false, false]);
  });
});

describe("moderation criteria", () => {
  const set = (ctx: Ctx, userId: number, columns: string) =>
    ctx.sqlite.prepare(`UPDATE users SET ${columns} WHERE id = ?1`).run(userId);

  test("a restriction is active while its expiry on the member's row lies ahead", () => {
    const { ctx, member, other } = world();
    const third = insertUser(ctx).id;
    const fourth = insertUser(ctx).id;
    const ahead = ctx.now() + 60_000;
    set(ctx, member, `restricted_posting_until = ${ahead}`);
    set(ctx, other, "restricted_posting_until = 253402300799999");
    set(ctx, third, `restricted_posting_until = ${ctx.now()}`);
    const asks = (criterion: string, value: number) =>
      holdsFor(ctx, [member, other, third, fourth], { criterion, value });
    expect(asks("restricted_posting", 1)).toEqual([true, true, false, false]);
    expect(asks("restricted_posting", 0)).toEqual([false, false, true, true]);
    // The three kinds are separate.
    expect(asks("restricted_conversations", 1)).toEqual([false, false, false, false]);
    set(
      ctx,
      fourth,
      `restricted_conversations_until = ${ahead}, restricted_profile_posts_until = ${ahead}`,
    );
    expect(asks("restricted_conversations", 1)).toEqual([false, false, false, true]);
    expect(asks("restricted_profile_posts", 1)).toEqual([false, false, false, true]);
  });

  test("thread_banned holds for a ban that has not run out, in any thread", () => {
    const { ctx, member, other, node } = world();
    const third = insertUser(ctx).id;
    const [t1, t2] = [thread(ctx, other, node), thread(ctx, other, node)];
    const ban = (userId: number, threadId: number, expiresAt: number | null) =>
      insertRow(
        ctx,
        "INSERT INTO thread_bans (thread_id, user_id, moderator_id, created_at, expires_at) VALUES (?1, ?2, ?3, 1, ?4)",
        threadId,
        userId,
        other,
        expiresAt,
      );
    ban(member, t1, null);
    ban(member, t2, ctx.now() - 1);
    ban(other, t1, ctx.now() - 1);
    ban(third, t2, ctx.now() + 1);
    const asks = (value: number) =>
      holdsFor(ctx, [member, other, third], { criterion: "thread_banned", value });
    expect(asks(1)).toEqual([true, false, true]);
    expect(asks(0)).toEqual([false, true, false]);
  });

  test("banned_before holds for any ban on record, lifted, over or current", () => {
    const { ctx, member, other } = world();
    const [lifted, over, current, never] = [
      insertUser(ctx).id,
      insertUser(ctx).id,
      member,
      insertUser(ctx).id,
    ];
    const ban = (userId: number, expiresAt: number | null, liftedAt: number | null) =>
      insertRow(
        ctx,
        "INSERT INTO bans (user_id, moderator_id, reason, created_at, expires_at, lifted_at) VALUES (?1, ?2, 'r', 1, ?3, ?4)",
        userId,
        other,
        expiresAt,
        liftedAt,
      );
    ban(lifted, null, 5);
    ban(over, 3, null);
    ban(current, null, null);
    const asks = (value: number) =>
      holdsFor(ctx, [lifted, over, current, never], { criterion: "banned_before", value });
    expect(asks(1)).toEqual([true, true, true, false]);
    expect(asks(0)).toEqual([false, false, false, true]);
  });

  test("reports_resolved counts the member's reports that a moderator resolved", () => {
    const { ctx, member, other } = world();
    let target = 0;
    const report = (reporter: number, state: string) => {
      target += 1;
      const group = insertRow(
        ctx,
        "INSERT INTO report_groups (target_type, target_id, state, report_count, created_at, updated_at) VALUES ('post', ?1, ?2, 1, 1, 1)",
        target,
        state,
      );
      insertRow(
        ctx,
        "INSERT INTO reports (group_id, reporter_id, reason, created_at) VALUES (?1, ?2, 'r', 1)",
        group,
        reporter,
      );
    };
    report(member, "resolved");
    report(member, "resolved");
    report(member, "rejected");
    report(member, "open");
    report(other, "assigned");
    const asks = (value: number) =>
      holdsFor(ctx, [member, other], { criterion: "reports_resolved", value });
    expect(asks(2)).toEqual([true, false]);
    expect(asks(3)).toEqual([false, false]);
  });

  test("moderator_actions counts the member's entries in the moderator log", () => {
    const { ctx, member, other } = world();
    for (let n = 0; n < 3; n++)
      insertRow(
        ctx,
        "INSERT INTO moderator_log (actor_id, action, target_type, target_id, created_at) VALUES (?1, 'post.delete', 'post', ?2, 1)",
        member,
        n + 1,
      );
    insertRow(
      ctx,
      "INSERT INTO moderator_log (actor_id, action, target_type, target_id, created_at) VALUES (?1, 'post.delete', 'post', 9, 1)",
      other,
    );
    const asks = (value: number) =>
      holdsFor(ctx, [member, other], { criterion: "moderator_actions", value });
    expect(asks(3)).toEqual([true, false]);
    expect(asks(4)).toEqual([false, false]);
  });
});

describe("profile criteria", () => {
  const set = (ctx: Ctx, userId: number, columns: string) =>
    ctx.sqlite.prepare(`UPDATE users SET ${columns} WHERE id = ?1`).run(userId);

  test("a cover is an uploaded one or one from the gallery", () => {
    const { ctx, member, other } = world();
    const third = insertUser(ctx).id;
    set(ctx, member, "cover_preset_id = 4");
    set(ctx, other, "cover_file_id = 9");
    const asks = (value: number) =>
      holdsFor(ctx, [member, other, third], { criterion: "has_cover", value });
    expect(asks(1)).toEqual([true, true, false]);
    expect(asks(0)).toEqual([false, false, true]);
  });

  test("a name color, an accent color and a frame are each their own setting", () => {
    const { ctx, member, other } = world();
    set(ctx, member, "name_color_id = 1");
    set(ctx, other, "accent_color_id = 1, frame_id = 2");
    const asks = (criterion: string) => holdsFor(ctx, [member, other], { criterion, value: 1 });
    expect(asks("has_name_color")).toEqual([true, false]);
    expect(asks("has_accent_color")).toEqual([false, true]);
    expect(asks("has_frame")).toEqual([false, true]);
  });

  test("social links count the filled handles of Discord, Telegram and X", () => {
    const { ctx, member, other } = world();
    set(ctx, member, "social_discord = 'a#1', social_x = '@a'");
    set(ctx, other, "social_telegram = ''");
    const asks = (value: number) =>
      holdsFor(ctx, [member, other], { criterion: "social_links_at_least", value });
    expect(asks(2)).toEqual([true, false]);
    expect(asks(3)).toEqual([false, false]);
    expect(asks(0)).toEqual([true, true]);
  });

  test("a complete profile has an avatar, an about text, a location and a birthday", () => {
    const { ctx, member, other } = world();
    const complete =
      "avatar_file_id = 5, about = 'Hello', location = 'Madrid', birthday_md = '03-14'";
    set(ctx, member, complete);
    set(ctx, other, "avatar_file_id = 5, about = 'Hello', location = 'Madrid'");
    const asks = (value: number) =>
      holdsFor(ctx, [member, other], { criterion: "profile_complete", value });
    expect(asks(1)).toEqual([true, false]);
    for (const missing of [
      "avatar_file_id = NULL",
      "about = ''",
      "location = ''",
      "birthday_md = NULL",
    ]) {
      set(ctx, member, missing);
      expect(asks(1)).toEqual([false, false]);
      set(ctx, member, complete);
    }
  });

  test("a recent username change is read from the member's row", () => {
    const { ctx, member, other } = world();
    set(ctx, member, `username_changed_at = ${ctx.now() - 2 * 86_400_000}`);
    const asks = (value: number) =>
      holdsFor(ctx, [member, other], { criterion: "username_changed_within_days", value });
    expect(asks(2)).toEqual([true, false]);
    expect(asks(1)).toEqual([false, false]);
  });
});

describe("award criteria", () => {
  test("holds_awards holds for an award the member holds, however many times, not a revoked one", () => {
    const { ctx, member, other } = world();
    const award = (name: string) =>
      insertRow(
        ctx,
        "INSERT INTO awards (name, tier, created_at, updated_at) VALUES (?1, 'bronze', 0, 0)",
        name,
      );
    const [a, b, c] = [award("A"), award("B"), award("C")];
    const total = (userId: number, awardId: number, count: number) =>
      insertRow(
        ctx,
        "INSERT INTO member_award_totals (user_id, award_id, count) VALUES (?1, ?2, ?3)",
        userId,
        awardId,
        count,
      );
    total(member, a, 1);
    total(member, b, 3);
    total(member, c, 0);
    total(other, c, 1);
    const asks = (ids: number[], mode: "one" | "none" | "each") =>
      holdsFor(ctx, [member, other], { criterion: "holds_awards", ids, mode });
    expect(asks([a], "one")).toEqual([true, false]);
    expect(asks([b], "one")).toEqual([true, false]);
    expect(asks([c], "one")).toEqual([false, true]);
    expect(asks([a, b], "each")).toEqual([true, false]);
    expect(asks([a, c], "each")).toEqual([false, false]);
    expect(asks([a, c], "none")).toEqual([false, false]);
    expect(asks([c], "none")).toEqual([true, false]);
  });

  test("awards held and award XP are read from the member row", () => {
    const { ctx, member, other } = world();
    ctx.sqlite.prepare("UPDATE users SET award_count = 3, award_xp = 50 WHERE id = ?1").run(member);
    const asks = (criterion: string, value: number) =>
      holdsFor(ctx, [member, other], { criterion, value });
    expect(asks("awards_held_at_least", 3)).toEqual([true, false]);
    expect(asks("awards_held_at_least", 4)).toEqual([false, false]);
    expect(asks("award_xp_at_most", 50)).toEqual([true, true]);
    expect(asks("award_xp_at_most", 49)).toEqual([false, true]);
  });
});

describe("measured criteria", () => {
  test("every measured criterion's statement is answered from indexes", () => {
    const ctx = createTestContext();
    expect(criteriaMeasures.length).toBeGreaterThan(0);
    for (const { id, sql } of criteriaMeasures) {
      const params = measureSlots({ criterion: id, ids: [1] }, "[1,2]", ctx.now(), sql);
      expectNoTableScan(ctx, sql, params);
    }
  });

  test("a page of members costs one query per measured condition, not one per member", () => {
    const statements = (members: number) => {
      const ctx = createTestContext();
      const ids = Array.from({ length: members }, () => insertUser(ctx).id);
      const seen: string[] = [];
      const original = ctx.sqlite.prepare.bind(ctx.sqlite);
      (ctx.sqlite as { prepare: unknown }).prepare = (sql: string) => {
        seen.push(sql);
        return original(sql);
      };
      loadFacts(ctx, ids, [
        rule(
          { criterion: "posts_in_threads", ids: [1, 2], value: 1 },
          { criterion: "replies_received", value: 1 },
          { criterion: "bookmarks_at_least", value: 1 },
          // The same measurement under another threshold shares its query.
          { criterion: "replies_received", value: 9 },
        ),
      ]);
      return seen.length;
    };
    expect(statements(1)).toBe(3);
    expect(statements(40)).toBe(3);
  });
});

describe("assertRule: the new criteria", () => {
  const ctx = createTestContext();
  const refuses = (condition: Condition) =>
    expect(() => assertRule(ctx, rule(condition), "background")).toThrow(ValidationError);

  test("a measured criterion takes the number and list it declares, and no more", () => {
    refuses({ criterion: "replies_received" });
    refuses({ criterion: "replies_received", value: 1, ids: [1] });
    refuses({ criterion: "replies_received", value: 1, days: 3 });
    refuses({ criterion: "replies_received", value: 1, mode: "one" });
    refuses({ criterion: "posts_in_threads", value: 1 });
    refuses({ criterion: "posts_in_threads", ids: [1] });
    refuses({ criterion: "posts_in_threads", ids: [1], value: 1, mode: "none" });
    refuses({ criterion: "posts_in_threads", ids: [1], value: 1, days: 3 });
  });

  test("a thread that does not exist is refused, one that does is accepted", () => {
    const { ctx: seeded, member, node } = world();
    const real = thread(seeded, member, node);
    assertRule(
      seeded,
      rule({ criterion: "posts_in_threads", ids: [real], value: 2, mode: "all" }),
      "background",
    );
    expect(() =>
      assertRule(
        seeded,
        rule({ criterion: "posts_in_threads", ids: [real, 9999], value: 2 }),
        "background",
      ),
    ).toThrow(/Unknown thread: 9999/);
  });

  test("every definition says what its condition takes", () => {
    for (const definition of criterionDefinitions) {
      if (definition.kind === "groups" || definition.kind === "members")
        expect(definition.idKind).toBe(definition.kind);
      if (definition.kind === "ids") expect(definition.idKind).not.toBeNull();
      if (definition.modes.length > 0) expect(definition.idKind).not.toBeNull();
      if (definition.window) expect(definition.kind).not.toBe("boolean");
    }
  });
});
