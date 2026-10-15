import { expect, test } from "bun:test";
import { CRITERIA, LIMITS } from "@/lib/test-criteria";
import {
  addCondition,
  type Criterion,
  changeCondition,
  controlFor,
  draftOf,
  numberOf,
  offeredCriteria,
  PLACES,
  type Place,
  type Rule,
  removeCondition,
  ruleOfDraft,
} from "./criteria-rule";

const everything = {
  groups: true,
  items: true,
  awards: true,
  shopCategories: true,
  creditRules: true,
  reactionTypes: true,
};
const ids = (place: Place, available = everything) =>
  offeredCriteria(CRITERIA, place, available).map((entry) => entry.id);

test("promotions and awards are offered every criterion, in the backend's order", () => {
  for (const place of ["promotion", "award"] as const)
    expect(ids(place)).toEqual(CRITERIA.map((entry) => entry.id));
});

test("notices and the shop are offered every cheap criterion and no background one", () => {
  const cheap = CRITERIA.filter((entry) => entry.cost === "cheap").map(
    (entry) => entry.id,
  );
  const background = CRITERIA.filter((entry) => entry.cost === "background");
  // The new criteria that count history are background; the ones on the member's row are cheap.
  expect(background.map((entry) => entry.id)).toContain("posts_in_threads");
  expect(background.map((entry) => entry.id)).toContain("credits_earned");
  expect(cheap).toContain("holds_awards");
  expect(cheap).toContain("has_cover");
  expect(cheap).not.toContain("warning_points_below");
  expect(cheap.length + background.length).toBe(CRITERIA.length);
  for (const place of [
    "notice",
    "shopCategory",
    "shopItem",
    "postLinks",
    "postApproval",
  ] as const) {
    expect(PLACES[place].cheapOnly).toBe(true);
    expect(ids(place)).toEqual(cheap);
  }
});

test("a criterion that needs something to choose is not offered when there is nothing to choose", () => {
  const nothing = {
    groups: false,
    items: false,
    awards: false,
    shopCategories: false,
    creditRules: false,
    reactionTypes: false,
  };
  const without = ids("promotion", nothing);
  for (const id of [
    "in_group",
    "not_in_group",
    "purchased_item",
    "owns_item",
    "wears_item",
    "bought_in_category",
    "holds_awards",
    "credits_from_rule",
    "reactions_given_by_type",
    "reactions_received_by_type",
  ])
    expect(without, id).not.toContain(id);
  // Members and threads are searched, never chosen from a list held in the page.
  expect(without).toContain("is_member");
  expect(without).toContain("posts_in_threads");
  expect(ids("promotion", { ...nothing, groups: true })).toContain("in_group");
  expect(ids("promotion", { ...nothing, awards: true })).toContain(
    "holds_awards",
  );
  expect(ids("promotion", { ...nothing, reactionTypes: true })).toContain(
    "reactions_given_by_type",
  );
  expect(ids("promotion", { ...nothing, items: true })).toContain("owns_item");
  expect(ids("promotion", { ...nothing, items: true })).not.toContain(
    "bought_in_category",
  );
});

test("the reaction criteria: the best post is cheap, the counts by type are background, and none is offered to a reaction type", () => {
  // Counted by type: history, so promotions and awards only.
  for (const place of ["notice", "shopItem", "reactionType"] as const)
    expect(ids(place)).not.toContain("reactions_given_by_type");
  expect(ids("promotion")).toContain("reactions_received_by_type");
  // The best post is one seek: allowed where only cheap criteria are, but it measures history,
  // which a reaction type's rule may not.
  expect(ids("shopItem")).toContain("most_reacted_post");
  expect(ids("reactionType")).not.toContain("most_reacted_post");
});

test("an empty rule means everyone, manual only for an award, and is refused for a promotion", () => {
  expect(PLACES.promotion.empty).toBe("required");
  expect(PLACES.award.empty).toBe("manual");
  for (const place of [
    "notice",
    "shopCategory",
    "shopItem",
    "postLinks",
    "postApproval",
  ] as const)
    expect(PLACES[place].empty).toBe("everyone");
});

test("a rule goes into the builder and out of it unchanged, duplicates and any included", () => {
  const rules: Rule[] = [
    { match: "all", conditions: [] },
    {
      match: "any",
      conditions: [
        { criterion: "post_count", value: 5 },
        { criterion: "post_count", value: 100 },
        { criterion: "in_group", ids: [3, 4] },
        { criterion: "in_group", ids: [3] },
        { criterion: "made_up", value: 1 },
        { criterion: "has_avatar", value: 0 },
        { criterion: "post_count", ids: [1] },
        { criterion: "posts_in_threads", ids: [5, 6], value: 3, mode: "all" },
        { criterion: "credits_earned", value: 50, days: 30 },
        { criterion: "holds_awards", ids: [2], mode: "none" },
      ],
    },
  ];
  for (const rule of rules) expect(ruleOfDraft(draftOf(rule))).toEqual(rule);
});

test("adding gives a condition that is empty, except a yes/no one that must hold", () => {
  const start = draftOf({ match: "all", conditions: [] });
  const find = (id: string) => {
    const found = CRITERIA.find((entry) => entry.id === id);
    if (!found) throw new Error(id);
    return found;
  };
  const [post, avatar, group, threads, earned] = [
    "post_count",
    "has_avatar",
    "in_group",
    "posts_in_threads",
    "credits_earned",
  ].map(find);
  const draft = [post, avatar, group, post, threads, earned].reduce(
    (now, criterion) => addCondition(now, criterion as Criterion),
    start,
  );
  // A list that can be read in modes starts in the first one, the backend's own default.
  expect(ruleOfDraft(draft).conditions).toEqual([
    { criterion: "post_count" },
    { criterion: "has_avatar", value: 1 },
    { criterion: "in_group" },
    { criterion: "post_count" },
    { criterion: "posts_in_threads", mode: "each" },
    { criterion: "credits_earned" },
  ]);
  expect(new Set(draft.entries.map((entry) => entry.key)).size).toBe(6);
});

test("removing and changing touch one condition, even among duplicates", () => {
  let draft = draftOf({
    match: "any",
    conditions: [
      { criterion: "post_count", value: 5 },
      { criterion: "post_count", value: 100 },
      { criterion: "in_group", ids: [3] },
    ],
  });
  const [first = -1, second = -1, third = -1] = draft.entries.map(
    (entry) => entry.key,
  );
  draft = changeCondition(draft, second, { value: 7 });
  draft = changeCondition(draft, third, { ids: [3, 9] });
  expect(ruleOfDraft(draft).conditions).toEqual([
    { criterion: "post_count", value: 5 },
    { criterion: "post_count", value: 7 },
    { criterion: "in_group", ids: [3, 9] },
  ]);
  draft = changeCondition(draft, third, { ids: [] });
  draft = changeCondition(draft, first, { value: undefined });
  expect(ruleOfDraft(draft).conditions).toEqual([
    { criterion: "post_count" },
    { criterion: "post_count", value: 7 },
    { criterion: "in_group" },
  ]);
  draft = removeCondition(draft, second);
  expect(draft.entries.map((entry) => entry.key)).toEqual([first, third]);
  expect(draft.match).toBe("any");
});

test("changing a number, a list, a window or a mode leaves the rest of the condition as it was", () => {
  let draft = draftOf({
    match: "all",
    conditions: [
      { criterion: "posts_in_threads", ids: [5], value: 3, mode: "each" },
      { criterion: "credits_earned", value: 50 },
    ],
  });
  const [first = -1, second = -1] = draft.entries.map((entry) => entry.key);
  draft = changeCondition(draft, first, { mode: "all" });
  draft = changeCondition(draft, first, { ids: [5, 6] });
  draft = changeCondition(draft, second, { days: 30 });
  expect(ruleOfDraft(draft).conditions).toEqual([
    { criterion: "posts_in_threads", ids: [5, 6], value: 3, mode: "all" },
    { criterion: "credits_earned", value: 50, days: 30 },
  ]);
  // A window left empty is taken out.
  draft = changeCondition(draft, second, { days: undefined });
  expect(ruleOfDraft(draft).conditions[1]).toEqual({
    criterion: "credits_earned",
    value: 50,
  });
});

test("a condition is drawn only when its criterion is offered and it has the input that criterion takes", () => {
  const offered = offeredCriteria(CRITERIA, "notice", everything);
  expect(controlFor({ criterion: "post_count", value: 3 }, offered)?.id).toBe(
    "post_count",
  );
  expect(controlFor({ criterion: "in_group", ids: [1] }, offered)?.id).toBe(
    "in_group",
  );
  expect(controlFor({ criterion: "post_count", ids: [1] }, offered)).toBeNull();
  expect(controlFor({ criterion: "in_group", value: 1 }, offered)).toBeNull();
  expect(controlFor({ criterion: "has_avatar", value: 1 }, offered)?.id).toBe(
    "has_avatar",
  );
  expect(controlFor({ criterion: "has_avatar", value: 2 }, offered)).toBeNull();
  expect(controlFor({ criterion: "made_up", value: 1 }, offered)).toBeNull();
  // The new inputs: a list with a number and a mode, a window, a list with a mode only.
  const everyPlace = offeredCriteria(CRITERIA, "promotion", everything);
  const draws = (condition: Rule["conditions"][number]) =>
    controlFor(condition, everyPlace)?.id ?? null;
  expect(
    draws({ criterion: "posts_in_threads", ids: [1], value: 2, mode: "one" }),
  ).toBe("posts_in_threads");
  expect(
    draws({ criterion: "posts_in_threads", ids: [1], mode: "none" }),
  ).toBeNull();
  expect(draws({ criterion: "credits_earned", value: 5, days: 7 })).toBe(
    "credits_earned",
  );
  expect(draws({ criterion: "post_count", value: 5, days: 7 })).toBeNull();
  expect(draws({ criterion: "post_count", value: 5, mode: "one" })).toBeNull();
  expect(draws({ criterion: "holds_awards", ids: [1], mode: "none" })).toBe(
    "holds_awards",
  );
  expect(draws({ criterion: "holds_awards", ids: [1], value: 1 })).toBeNull();
  expect(draws({ criterion: "holds_awards" })).toBe("holds_awards");
  // Background in a notice: kept, not drawn.
  expect(
    controlFor({ criterion: "warning_points_below", value: 3 }, offered),
  ).toBeNull();
});

test("a typed number is a whole number up to the schema's limit, or nothing", () => {
  const max = LIMITS.value;
  expect(numberOf(" 12 ", max)).toBe(12);
  expect(numberOf("0", max)).toBe(0);
  expect(numberOf(String(max), max)).toBe(max);
  // Ten digits fit the pattern but not the schema.
  for (const bad of [
    "",
    "-1",
    "1.5",
    "1e3",
    "x",
    "12345678901",
    "2000000000",
    String(max + 1),
  ])
    expect(numberOf(bad, max)).toBeUndefined();
});

test("reaction types are offered the cheap criteria that do not measure the member's history", () => {
  const offered = ids("reactionType");
  const expected = CRITERIA.filter(
    (entry) => entry.cost === "cheap" && !entry.measured,
  ).map((entry) => entry.id);
  expect(offered).toEqual(expected);
  for (const id of [
    "thread_banned",
    "banned_before",
    "holds_awards",
    "owns_item",
  ])
    expect(offered).not.toContain(id);
  for (const id of ["post_count", "in_group", "purchases_at_least"])
    expect(offered).toContain(id);
});
