import { describe, expect, test } from "bun:test";
import type { Ctx } from "../context";
import { ValidationError } from "../errors";
import { createTestContext, expectNoTableScan, insertUser, userActor } from "../testing";
import {
  actorFacts,
  assertRule,
  type Condition,
  criterionDefinitions,
  evaluate,
  everyone,
  type Facts,
  groupsReadBy,
  guestFacts,
  loadFacts,
  memberFactsSql,
  type Rule,
} from "./criteria";
import { type Measure, measureKey } from "./criteria/types";

const NOW = 100 * 86_400_000;
const DAY = 86_400_000;
const facts = (overrides: Partial<Facts> = {}): Facts => ({
  memberId: 1,
  now: NOW,
  postCount: 0,
  createdAt: NOW,
  reactionScore: 0,
  emailVerified: false,
  hasAvatar: false,
  lastActivityAt: null,
  credits: 0,
  purchaseCount: 0,
  warningPoints: 0,
  purchasedItemIds: new Set(),
  groupIds: new Set(),
  hasCover: false,
  hasNameColor: false,
  hasAccentColor: false,
  hasFrame: false,
  socialLinkCount: 0,
  profileComplete: false,
  usernameChangedAt: null,
  restrictedPosting: false,
  restrictedConversations: false,
  restrictedProfilePosts: false,
  awardCount: 0,
  awardXp: 0,
  measures: new Map(),
  ...overrides,
});
/** A member whose measure for a condition is given (the loader's job in real use). */
const measured = (
  criterion: string,
  condition: Omit<Condition, "criterion">,
  measure: Measure,
): Facts => facts({ measures: new Map([[measureKey({ criterion, ...condition }), measure]]) });
const counts = (...pairs: [number, number][]) => new Map(pairs);
/** The cases of a yes/no criterion read from one flag of the member's facts. */
const yesNo = (flag: keyof Facts): Case[] => [
  ["has it, must", { value: 1 }, facts({ [flag]: true }), true],
  ["lacks it, must", { value: 1 }, facts({ [flag]: false }), false],
  ["lacks it, must not", { value: 0 }, facts({ [flag]: false }), true],
  ["has it, must not", { value: 0 }, facts({ [flag]: true }), false],
];
/** The cases of a yes/no criterion that one lookup answers (a row exists or it does not). */
const lookupCases = (criterion: string): Case[] => [
  ["has one, must", { value: 1 }, measured(criterion, {}, 1), true],
  ["has none, must", { value: 1 }, facts(), false],
  ["has none, must not", { value: 0 }, facts(), true],
  ["has one, must not", { value: 0 }, measured(criterion, {}, 1), false],
];
/** The cases of a criterion that holds items, categories or the like: one of them, or each. */
const ownCases = (criterion: string): Case[] => [
  ["one of several", { ids: [1, 2] }, measured(criterion, { ids: [1, 2] }, counts([2, 1])), true],
  [
    "one of several, mode one",
    { ids: [1, 2], mode: "one" },
    measured(criterion, { ids: [1, 2] }, counts([1, 1])),
    true,
  ],
  ["none of them", { ids: [1, 2], mode: "one" }, facts(), false],
  [
    "each: all held",
    { ids: [1, 2], mode: "each" },
    measured(criterion, { ids: [1, 2] }, counts([1, 1], [2, 1])),
    true,
  ],
  [
    "each: one missing",
    { ids: [1, 2], mode: "each" },
    measured(criterion, { ids: [1, 2] }, counts([1, 1])),
    false,
  ],
];
/** The cases of a criterion that counts rows and holds from a given number. */
const countCases = (criterion: string): Case[] => [
  ["above", { value: 5 }, measured(criterion, {}, 6), true],
  ["edge", { value: 5 }, measured(criterion, {}, 5), true],
  ["below", { value: 5 }, measured(criterion, {}, 4), false],
  ["nothing found", { value: 1 }, facts(), false],
  ["zero asked", { value: 0 }, facts(), true],
];
const all = (...conditions: Condition[]): Rule => ({ match: "all", conditions });
const any = (...conditions: Condition[]): Rule => ({ match: "any", conditions });

type Case = [label: string, condition: Omit<Condition, "criterion">, member: Facts, holds: boolean];
/** Every criterion of the registry: it holds, it does not hold, and the edge value. */
const table: Record<string, Case[]> = {
  post_count: [
    ["above", { value: 10 }, facts({ postCount: 11 }), true],
    ["edge", { value: 10 }, facts({ postCount: 10 }), true],
    ["below", { value: 10 }, facts({ postCount: 9 }), false],
  ],
  days_registered: [
    ["older", { value: 30 }, facts({ createdAt: NOW - 31 * DAY }), true],
    ["edge", { value: 30 }, facts({ createdAt: NOW - 30 * DAY }), true],
    ["newer", { value: 30 }, facts({ createdAt: NOW - 30 * DAY + 1 }), false],
  ],
  reaction_score: [
    ["above", { value: 5 }, facts({ reactionScore: 6 }), true],
    ["edge", { value: 5 }, facts({ reactionScore: 5 }), true],
    ["below", { value: 5 }, facts({ reactionScore: 4 }), false],
  ],
  email_verified: [
    ["verified, must be", { value: 1 }, facts({ emailVerified: true }), true],
    ["unverified, must be", { value: 1 }, facts({ emailVerified: false }), false],
    ["unverified, must not be", { value: 0 }, facts({ emailVerified: false }), true],
    ["verified, must not be", { value: 0 }, facts({ emailVerified: true }), false],
  ],
  has_avatar: [
    ["has one, must", { value: 1 }, facts({ hasAvatar: true }), true],
    ["has none, must", { value: 1 }, facts({ hasAvatar: false }), false],
    ["has none, must not", { value: 0 }, facts({ hasAvatar: false }), true],
    ["has one, must not", { value: 0 }, facts({ hasAvatar: true }), false],
  ],
  active_within_days: [
    ["recent", { value: 7 }, facts({ lastActivityAt: NOW - 3 * DAY }), true],
    ["edge", { value: 7 }, facts({ lastActivityAt: NOW - 7 * DAY }), true],
    ["too long ago", { value: 7 }, facts({ lastActivityAt: NOW - 7 * DAY - 1 }), false],
    ["never active", { value: 7 }, facts({ lastActivityAt: null }), false],
  ],
  inactive_days: [
    ["gone long", { value: 7 }, facts({ lastActivityAt: NOW - 8 * DAY }), true],
    ["edge", { value: 7 }, facts({ lastActivityAt: NOW - 7 * DAY }), true],
    ["recent", { value: 7 }, facts({ lastActivityAt: NOW - 7 * DAY + 1 }), false],
    ["never active", { value: 7 }, facts({ lastActivityAt: null }), true],
  ],
  warning_points_below: [
    ["under", { value: 5 }, facts({ warningPoints: 4 }), true],
    ["edge is excluded", { value: 5 }, facts({ warningPoints: 5 }), false],
    ["none, limit 0", { value: 0 }, facts({ warningPoints: 0 }), false],
  ],
  credits_at_least: [
    ["above", { value: 100 }, facts({ credits: 101 }), true],
    ["edge", { value: 100 }, facts({ credits: 100 }), true],
    ["below", { value: 100 }, facts({ credits: 99 }), false],
    ["negative balance", { value: 0 }, facts({ credits: -5 }), false],
  ],
  credits_at_most: [
    ["below", { value: 100 }, facts({ credits: 99 }), true],
    ["edge", { value: 100 }, facts({ credits: 100 }), true],
    ["above", { value: 100 }, facts({ credits: 101 }), false],
    ["negative balance counts", { value: 0 }, facts({ credits: -40 }), true],
  ],
  purchased_item: [
    ["bought", { value: 7 }, facts({ purchasedItemIds: new Set([7, 8]) }), true],
    ["bought another", { value: 7 }, facts({ purchasedItemIds: new Set([8]) }), false],
    ["bought none", { value: 7 }, facts(), false],
  ],
  purchases_at_least: [
    ["above", { value: 3 }, facts({ purchaseCount: 4 }), true],
    ["edge", { value: 3 }, facts({ purchaseCount: 3 }), true],
    ["below", { value: 3 }, facts({ purchaseCount: 2 }), false],
    ["zero asked", { value: 0 }, facts({ purchaseCount: 0 }), true],
  ],
  is_guest: [
    ["guest, must be", { value: 1 }, guestFacts(createTestContext()), true],
    ["member, must be", { value: 1 }, facts(), false],
    ["member, must not be", { value: 0 }, facts(), true],
    ["guest, must not be", { value: 0 }, guestFacts(createTestContext()), false],
  ],
  in_group: [
    ["in the group", { ids: [3] }, facts({ groupIds: new Set([2, 3]) }), true],
    ["in one of several", { ids: [9, 3] }, facts({ groupIds: new Set([3]) }), true],
    ["in another group", { ids: [3] }, facts({ groupIds: new Set([2]) }), false],
    ["in none", { ids: [3] }, facts(), false],
  ],
  not_in_group: [
    ["in another group", { ids: [3] }, facts({ groupIds: new Set([2]) }), true],
    ["in the group", { ids: [3] }, facts({ groupIds: new Set([3]) }), false],
    ["in one of several", { ids: [9, 3] }, facts({ groupIds: new Set([3]) }), false],
    ["in none", { ids: [3] }, facts(), true],
  ],
  is_member: [
    ["listed", { ids: [4, 1] }, facts({ memberId: 1 }), true],
    ["not listed", { ids: [4, 5] }, facts({ memberId: 1 }), false],
  ],
  posts_in_threads: [
    [
      "each: all reach it",
      { ids: [1, 2], value: 3, mode: "each" },
      measured("posts_in_threads", { ids: [1, 2] }, counts([1, 3], [2, 5])),
      true,
    ],
    [
      "each: one falls short",
      { ids: [1, 2], value: 3, mode: "each" },
      measured("posts_in_threads", { ids: [1, 2] }, counts([1, 3], [2, 2])),
      false,
    ],
    [
      "each: one never posted in",
      { ids: [1, 2], value: 1, mode: "each" },
      measured("posts_in_threads", { ids: [1, 2] }, counts([1, 3])),
      false,
    ],
    [
      "each is the default",
      { ids: [1, 2], value: 1 },
      measured("posts_in_threads", { ids: [1, 2] }, counts([1, 3])),
      false,
    ],
    [
      "one: any reaches it",
      { ids: [1, 2], value: 3, mode: "one" },
      measured("posts_in_threads", { ids: [1, 2] }, counts([1, 0], [2, 3])),
      true,
    ],
    [
      "one: none does",
      { ids: [1, 2], value: 3, mode: "one" },
      measured("posts_in_threads", { ids: [1, 2] }, counts([1, 2], [2, 2])),
      false,
    ],
    [
      "all combined: the sum reaches it",
      { ids: [1, 2], value: 4, mode: "all" },
      measured("posts_in_threads", { ids: [1, 2] }, counts([1, 2], [2, 2])),
      true,
    ],
    [
      "all combined: the sum falls short",
      { ids: [1, 2], value: 4, mode: "all" },
      measured("posts_in_threads", { ids: [1, 2] }, counts([1, 2], [2, 1])),
      false,
    ],
    [
      "a thread listed twice counts once",
      { ids: [1, 1], value: 4, mode: "all" },
      measured("posts_in_threads", { ids: [1, 1] }, counts([1, 2])),
      false,
    ],
    ["no posts at all", { ids: [1], value: 1, mode: "one" }, facts(), false],
  ],
  replies_received: countCases("replies_received"),
  busiest_thread_replies: countCases("busiest_thread_replies"),
  profile_posts_written: countCases("profile_posts_written"),
  profile_comments_written: countCases("profile_comments_written"),
  attachments_uploaded: countCases("attachments_uploaded"),
  bookmarks_at_least: countCases("bookmarks_at_least"),
  watching_forums_at_least: countCases("watching_forums_at_least"),
  watching_threads_at_least: countCases("watching_threads_at_least"),
  owns_item: ownCases("owns_item"),
  wears_item: ownCases("wears_item"),
  bought_in_category: ownCases("bought_in_category"),
  gifted_items: countCases("gifted_items"),
  credits_earned: [
    ["all time, above", { value: 50 }, measured("credits_earned", {}, 60), true],
    ["all time, edge", { value: 50 }, measured("credits_earned", {}, 50), true],
    ["all time, below", { value: 50 }, measured("credits_earned", {}, 49), false],
    ["net of reversals can be negative", { value: 0 }, measured("credits_earned", {}, -3), false],
    [
      "in a window, reached",
      { value: 50, days: 7 },
      measured("credits_earned", { days: 7 }, 50),
      true,
    ],
    [
      "in a window, short",
      { value: 50, days: 7 },
      measured("credits_earned", { days: 7 }, 49),
      false,
    ],
    [
      "a window is a different measurement from all time",
      { value: 50, days: 7 },
      measured("credits_earned", {}, 500),
      false,
    ],
    ["nothing earned", { value: 1 }, facts(), false],
  ],
  has_cover: yesNo("hasCover"),
  has_name_color: yesNo("hasNameColor"),
  has_accent_color: yesNo("hasAccentColor"),
  has_frame: yesNo("hasFrame"),
  profile_complete: yesNo("profileComplete"),
  social_links_at_least: [
    ["all three", { value: 3 }, facts({ socialLinkCount: 3 }), true],
    ["edge", { value: 2 }, facts({ socialLinkCount: 2 }), true],
    ["one short", { value: 2 }, facts({ socialLinkCount: 1 }), false],
    ["none, none asked", { value: 0 }, facts(), true],
  ],
  username_changed_within_days: [
    ["changed recently", { value: 30 }, facts({ usernameChangedAt: NOW - 3 * DAY }), true],
    ["edge", { value: 30 }, facts({ usernameChangedAt: NOW - 30 * DAY }), true],
    ["too long ago", { value: 30 }, facts({ usernameChangedAt: NOW - 30 * DAY - 1 }), false],
    ["never changed", { value: 30 }, facts({ usernameChangedAt: null }), false],
  ],
  restricted_posting: yesNo("restrictedPosting"),
  restricted_conversations: yesNo("restrictedConversations"),
  restricted_profile_posts: yesNo("restrictedProfilePosts"),
  thread_banned: lookupCases("thread_banned"),
  banned_before: lookupCases("banned_before"),
  reports_resolved: countCases("reports_resolved"),
  moderator_actions: countCases("moderator_actions"),
  awards_held_at_least: [
    ["above", { value: 3 }, facts({ awardCount: 4 }), true],
    ["edge", { value: 3 }, facts({ awardCount: 3 }), true],
    ["below", { value: 3 }, facts({ awardCount: 2 }), false],
    ["none held, none asked", { value: 0 }, facts(), true],
  ],
  award_xp_at_most: [
    ["below", { value: 100 }, facts({ awardXp: 99 }), true],
    ["edge", { value: 100 }, facts({ awardXp: 100 }), true],
    ["above", { value: 100 }, facts({ awardXp: 101 }), false],
    ["no award at all", { value: 0 }, facts(), true],
  ],
  holds_awards: [
    [
      "one: holds one of them",
      { ids: [1, 2], mode: "one" },
      measured("holds_awards", { ids: [1, 2] }, counts([2, 1])),
      true,
    ],
    [
      "one is the default",
      { ids: [1, 2] },
      measured("holds_awards", { ids: [1, 2] }, counts([1, 2])),
      true,
    ],
    ["one: holds none of them", { ids: [1, 2], mode: "one" }, facts(), false],
    ["none: holds none of them", { ids: [1, 2], mode: "none" }, facts(), true],
    [
      "none: holds one of them",
      { ids: [1, 2], mode: "none" },
      measured("holds_awards", { ids: [1, 2] }, counts([2, 1])),
      false,
    ],
    [
      "each: holds all of them",
      { ids: [1, 2], mode: "each" },
      measured("holds_awards", { ids: [1, 2] }, counts([1, 1], [2, 3])),
      true,
    ],
    [
      "each: misses one",
      { ids: [1, 2], mode: "each" },
      measured("holds_awards", { ids: [1, 2] }, counts([1, 1])),
      false,
    ],
  ],
  credits_from_rule: [
    [
      "all combined reach it",
      { ids: [1, 2], value: 30, mode: "all" },
      measured("credits_from_rule", { ids: [1, 2] }, counts([1, 10], [2, 20])),
      true,
    ],
    [
      "all combined fall short",
      { ids: [1, 2], value: 31, mode: "all" },
      measured("credits_from_rule", { ids: [1, 2] }, counts([1, 10], [2, 20])),
      false,
    ],
    [
      "all combined is the default",
      { ids: [1, 2], value: 30 },
      measured("credits_from_rule", { ids: [1, 2] }, counts([1, 10], [2, 20])),
      true,
    ],
    [
      "one rule is enough",
      { ids: [1, 2], value: 20, mode: "one" },
      measured("credits_from_rule", { ids: [1, 2] }, counts([1, 10], [2, 20])),
      true,
    ],
    [
      "each rule must reach it",
      { ids: [1, 2], value: 20, mode: "each" },
      measured("credits_from_rule", { ids: [1, 2] }, counts([1, 10], [2, 20])),
      false,
    ],
    [
      "in a window",
      { ids: [1], value: 5, days: 30, mode: "one" },
      measured("credits_from_rule", { ids: [1], days: 30 }, counts([1, 5])),
      true,
    ],
    ["no credits from them", { ids: [1], value: 1, mode: "one" }, facts(), false],
  ],
};

describe("evaluate: every criterion", () => {
  test("the table covers the whole registry", () => {
    expect(Object.keys(table).sort()).toEqual(criterionDefinitions.map((d) => d.id).sort());
  });

  for (const [criterion, cases] of Object.entries(table))
    for (const [label, condition, member, holds] of cases)
      test(`${criterion}: ${label}`, () => {
        expect(evaluate(all({ criterion, ...condition }), member)).toBe(holds);
      });
});

describe("evaluate: rules", () => {
  const member = facts({ credits: 50, purchaseCount: 1 });
  const atLeast50: Condition = { criterion: "credits_at_least", value: 50 };
  const bought1: Condition = { criterion: "purchases_at_least", value: 1 };
  const atMost49: Condition = { criterion: "credits_at_most", value: 49 };

  test("an empty rule is everyone, whatever match says, guests included", () => {
    expect(evaluate(everyone(), member)).toBe(true);
    expect(evaluate(any(), member)).toBe(true);
    expect(evaluate(everyone(), guestFacts(createTestContext()))).toBe(true);
  });

  test("all needs every condition", () => {
    expect(evaluate(all(atLeast50, bought1), member)).toBe(true);
    expect(evaluate(all(atLeast50, bought1, atMost49), member)).toBe(false);
  });

  test("any needs one condition", () => {
    expect(evaluate(any(atMost49, bought1), member)).toBe(true);
    expect(evaluate(any(atMost49, { criterion: "post_count", value: 1 }), member)).toBe(false);
  });

  test("a criterion that does not exist never holds", () => {
    expect(evaluate(all({ criterion: "made_up", value: 0 }), member)).toBe(false);
    expect(evaluate(any({ criterion: "made_up", value: 0 }), member)).toBe(false);
    expect(evaluate(any({ criterion: "made_up", value: 0 }, bought1), member)).toBe(true);
  });

  test("a condition without what its criterion takes never holds", () => {
    expect(evaluate(all({ criterion: "post_count" }), member)).toBe(false);
    expect(evaluate(all({ criterion: "in_group" }), member)).toBe(false);
  });

  test("a guest satisfies only the audience criteria", () => {
    const guest = guestFacts(createTestContext());
    expect(evaluate(all({ criterion: "inactive_days", value: 0 }), guest)).toBe(false);
    expect(evaluate(all({ criterion: "credits_at_most", value: 0 }), guest)).toBe(false);
    expect(evaluate(all({ criterion: "is_member", ids: [1] }), guest)).toBe(false);
    expect(evaluate(all({ criterion: "in_group", ids: [1] }), guest)).toBe(false);
    expect(evaluate(all({ criterion: "not_in_group", ids: [2] }), guest)).toBe(true);
    expect(evaluate(all({ criterion: "is_guest", value: 1 }), guest)).toBe(true);
  });
});

describe("assertRule", () => {
  const ctx = createTestContext();
  const refuses = (rule: Rule, allowed: "cheap" | "background") =>
    expect(() => assertRule(ctx, rule, allowed)).toThrow(ValidationError);

  test("accepts the empty rule and every criterion with what it takes", () => {
    assertRule(ctx, everyone(), "cheap");
    assertRule(
      ctx,
      all(
        { criterion: "post_count", value: 3 },
        { criterion: "email_verified", value: 0 },
        { criterion: "in_group", ids: [2, 3] },
        { criterion: "is_member", ids: [1] },
      ),
      "cheap",
    );
  });

  test("refuses an unknown criterion", () => {
    refuses(all({ criterion: "made_up", value: 1 }), "background");
  });

  test("refuses a condition that lacks, or has too much of, what its criterion takes", () => {
    refuses(all({ criterion: "post_count" }), "background");
    refuses(all({ criterion: "post_count", value: 1, ids: [1] }), "background");
    refuses(all({ criterion: "in_group", value: 1 }), "background");
    refuses(all({ criterion: "in_group", ids: [1], value: 1 }), "background");
    refuses(all({ criterion: "is_member" }), "background");
  });

  test("refuses a yes/no value other than 0 and 1", () => {
    for (const criterion of ["email_verified", "has_avatar", "is_guest"])
      refuses(all({ criterion, value: 2 }), "background");
  });

  test("refuses a group that does not exist", () => {
    refuses(all({ criterion: "in_group", ids: [2, 9999] }), "cheap");
    refuses(all({ criterion: "not_in_group", ids: [9999] }), "background");
  });

  test("a consumer that allows only cheap criteria refuses every background one", () => {
    const background = criterionDefinitions.filter(
      (definition) => definition.cost === "background",
    );
    expect(background.length).toBeGreaterThan(0);
    for (const definition of background)
      refuses(all({ criterion: definition.id, value: 1 }), "cheap");
    assertRule(ctx, all({ criterion: "warning_points_below", value: 1 }), "background");
  });
});

function stampStatements(ctx: Ctx) {
  const statements: string[] = [];
  const original = ctx.sqlite.prepare.bind(ctx.sqlite);
  (ctx.sqlite as { prepare: unknown }).prepare = (sql: string) => {
    statements.push(sql);
    return original(sql);
  };
  return {
    statements,
    restore: () => {
      (ctx.sqlite as { prepare: unknown }).prepare = original;
    },
  };
}

function shopItem(ctx: Ctx, name: string): number {
  const category = ctx.sqlite
    .prepare<{ id: number }, []>(
      "INSERT INTO shop_categories (name, created_at, updated_at) VALUES ('Cat', 0, 0) RETURNING id",
    )
    .get()!.id;
  return ctx.sqlite
    .prepare<{ id: number }, [number, string]>(
      "INSERT INTO shop_items (category_id, name, price, effect, created_at, updated_at) VALUES (?1, ?2, 5, '{}', 0, 0) RETURNING id",
    )
    .get(category, name)!.id;
}
function purchase(ctx: Ctx, buyerId: number, itemId: number, recipientId = buyerId) {
  ctx.sqlite
    .prepare(
      "INSERT INTO shop_purchases (item_id, buyer_id, recipient_id, price, created_at) VALUES (?1, ?2, ?3, 5, 0)",
    )
    .run(itemId, buyerId, recipientId);
}

describe("loadFacts", () => {
  test("reads the member row and the verified email", () => {
    const ctx = createTestContext();
    const user = insertUser(ctx);
    ctx.sqlite
      .prepare(
        "UPDATE users SET post_count = 12, reaction_score = 4, credits = -7, shop_purchase_count = 3, last_activity_at = 555, created_at = 99, avatar_file_id = NULL, award_count = 4, award_xp = 70 WHERE id = ?1",
      )
      .run(user.id);
    ctx.sqlite.prepare("UPDATE auth_user SET email_verified = 1 WHERE id = ?1").run(user.id);
    const [loaded] = [
      ...loadFacts(ctx, [user.id], [all({ criterion: "post_count", value: 1 })]).values(),
    ];
    expect(loaded).toMatchObject({
      memberId: user.id,
      now: ctx.now(),
      postCount: 12,
      reactionScore: 4,
      credits: -7,
      purchaseCount: 3,
      lastActivityAt: 555,
      createdAt: 99,
      hasAvatar: false,
      emailVerified: true,
      awardCount: 4,
      awardXp: 70,
    });
  });

  test("groups are every group the member holds, however obtained", () => {
    const ctx = createTestContext();
    const [a, b, c] = [insertUser(ctx), insertUser(ctx), insertUser(ctx, { groupId: 3 })];
    ctx.sqlite
      .prepare(
        "INSERT INTO user_groups (user_id, group_id, created_at) VALUES (?1, 3, 0), (?1, 4, 0)",
      )
      .run(a.id);
    const promotion = ctx.sqlite
      .prepare<{ id: number }, []>(
        "INSERT INTO promotions (title, group_ids, created_at, updated_at) VALUES ('P', '[]', 0, 0) RETURNING id",
      )
      .get()!.id;
    const custom = ctx.sqlite
      .prepare<{ id: number }, [number]>(
        "INSERT INTO groups (title, rank) VALUES ('Custom', ?1) RETURNING id",
      )
      .get(5)!.id;
    ctx.sqlite
      .prepare(
        "INSERT INTO user_group_grants (user_id, promotion_id, group_id, created_at) VALUES (?1, ?2, ?3, 0)",
      )
      .run(b.id, promotion, custom);
    ctx.sqlite
      .prepare(
        "INSERT INTO shop_group_grants (user_id, inventory_id, group_id, created_at) VALUES (?1, 1, 5, 0)",
      )
      .run(c.id);
    const loaded = loadFacts(ctx, [a.id, b.id, c.id], [all({ criterion: "in_group", ids: [3] })]);
    expect([...loaded.get(a.id)!.groupIds].sort()).toEqual([2, 3, 4]);
    expect([...loaded.get(b.id)!.groupIds].sort()).toEqual([2, custom].sort());
    expect([...loaded.get(c.id)!.groupIds].sort()).toEqual([3, 5]);
    // A rule sees them all: in the group a promotion granted, or one a purchase added.
    expect(evaluate(all({ criterion: "in_group", ids: [custom] }), loaded.get(b.id)!)).toBe(true);
    expect(evaluate(all({ criterion: "in_group", ids: [5] }), loaded.get(c.id)!)).toBe(true);
    expect(evaluate(all({ criterion: "not_in_group", ids: [5] }), loaded.get(c.id)!)).toBe(false);
  });

  test("groupsReadBy lists the groups a rule reads and no other ids", () => {
    expect(
      groupsReadBy(
        all(
          { criterion: "in_group", ids: [3, 4] },
          { criterion: "not_in_group", ids: [5] },
          { criterion: "is_member", ids: [9] },
          { criterion: "post_count", value: 9 },
          { criterion: "made_up", ids: [8] },
        ),
      ),
    ).toEqual([3, 4, 5]);
    expect(groupsReadBy(everyone())).toEqual([]);
  });

  test("warning points are the unexpired ones, summed per member", () => {
    const ctx = createTestContext();
    const [a, b] = [insertUser(ctx), insertUser(ctx)];
    const moderator = insertUser(ctx, { groupId: 3 });
    const warn = ctx.sqlite.prepare(
      "INSERT INTO warnings (user_id, moderator_id, points, reason, created_at, expires_at) VALUES (?1, ?2, ?3, 'r', 0, ?4)",
    );
    warn.run(a.id, moderator.id, 2, null);
    warn.run(a.id, moderator.id, 3, ctx.now() + 10_000);
    warn.run(a.id, moderator.id, 40, ctx.now() - 1);
    const loaded = loadFacts(
      ctx,
      [a.id, b.id],
      [all({ criterion: "warning_points_below", value: 9 })],
    );
    expect(loaded.get(a.id)!.warningPoints).toBe(5);
    expect(loaded.get(b.id)!.warningPoints).toBe(0);
  });

  test("purchased items: only the items asked about, a gift counts for the buyer", () => {
    const ctx = createTestContext();
    const [a, b, c] = [insertUser(ctx), insertUser(ctx), insertUser(ctx)];
    const [x, y, z] = [shopItem(ctx, "X"), shopItem(ctx, "Y"), shopItem(ctx, "Z")];
    purchase(ctx, a.id, x);
    purchase(ctx, a.id, x);
    purchase(ctx, a.id, y);
    purchase(ctx, b.id, z); // nobody asks about z
    purchase(ctx, b.id, x, c.id); // a gift to c
    const loaded = loadFacts(
      ctx,
      [a.id, b.id, c.id],
      [
        all({ criterion: "purchased_item", value: x }),
        all({ criterion: "post_count", value: 3 }, { criterion: "purchased_item", value: y }),
      ],
    );
    expect([...loaded.get(a.id)!.purchasedItemIds].sort()).toEqual([x, y].sort());
    expect([...loaded.get(b.id)!.purchasedItemIds]).toEqual([x]);
    expect(loaded.get(c.id)!.purchasedItemIds.size).toBe(0);
  });

  test("a page of members costs one query per kind of fact the rules ask for, and nothing else", () => {
    const reads = (rules: (item: number) => Rule[]) => {
      // A fresh context each time: prepared statements are cached per context.
      const ctx = createTestContext();
      const members = Array.from({ length: 20 }, () => insertUser(ctx).id);
      const item = shopItem(ctx, "Item");
      const spy = stampStatements(ctx);
      try {
        loadFacts(ctx, members, rules(item));
        return spy.statements.length;
      } finally {
        spy.restore();
      }
    };
    expect(reads(() => [everyone()])).toBe(0);
    expect(
      reads(() => [all({ criterion: "is_guest", value: 0 }, { criterion: "is_member", ids: [1] })]),
    ).toBe(0);
    expect(
      reads(() => [
        all({ criterion: "post_count", value: 1 }, { criterion: "credits_at_least", value: 1 }),
      ]),
    ).toBe(1);
    expect(reads(() => [all({ criterion: "in_group", ids: [2] })])).toBe(1);
    expect(
      reads((item) => [
        all({ criterion: "post_count", value: 1 }),
        any({ criterion: "in_group", ids: [2] }, { criterion: "purchased_item", value: item }),
        all({ criterion: "warning_points_below", value: 3 }),
      ]),
    ).toBe(4);
  });

  test("a rule that names an item but no member page loads nothing", () => {
    const ctx = createTestContext();
    expect(loadFacts(ctx, [], [all({ criterion: "post_count", value: 1 })]).size).toBe(0);
  });

  test("its queries use indexes", () => {
    const ctx = createTestContext();
    expectNoTableScan(ctx, memberFactsSql, ["[1,2]", 0]);
    expectNoTableScan(
      ctx,
      "SELECT user_id, sum(points) AS points FROM warnings WHERE user_id IN (SELECT value FROM json_each(?1)) AND (expires_at IS NULL OR expires_at > ?2) GROUP BY user_id",
      ["[1,2]", 0],
    );
    expectNoTableScan(
      ctx,
      "SELECT m.value AS buyer_id, i.value AS item_id FROM json_each(?1) m, json_each(?2) i WHERE EXISTS (SELECT 1 FROM shop_purchases p WHERE p.buyer_id = m.value AND p.item_id = i.value)",
      ["[1,2]", "[1,2]"],
    );
    expectNoTableScan(
      ctx,
      "SELECT id AS user_id, group_id FROM users WHERE id IN (SELECT value FROM json_each(?1)) UNION ALL SELECT user_id, group_id FROM user_groups WHERE user_id IN (SELECT value FROM json_each(?1)) UNION ALL SELECT user_id, group_id FROM user_group_grants WHERE user_id IN (SELECT value FROM json_each(?1)) UNION ALL SELECT user_id, group_id FROM shop_group_grants WHERE user_id IN (SELECT value FROM json_each(?1))",
      ["[1,2]"],
    );
    expectNoTableScan(ctx, "SELECT id FROM groups WHERE id IN (SELECT value FROM json_each(?1))", [
      "[1,2]",
    ]);
  });
});

describe("actorFacts", () => {
  test("a guest has the facts of a guest and a member's are loaded", () => {
    const ctx = createTestContext();
    const user = insertUser(ctx);
    ctx.sqlite.prepare("UPDATE users SET post_count = 9 WHERE id = ?1").run(user.id);
    const rule = all({ criterion: "post_count", value: 9 });
    expect(evaluate(rule, actorFacts(ctx, { kind: "guest" }, [rule]))).toBe(false);
    expect(actorFacts(ctx, { kind: "guest" }, [rule]).memberId).toBeNull();
    expect(evaluate(rule, actorFacts(ctx, userActor(user), [rule]))).toBe(true);
  });
});
