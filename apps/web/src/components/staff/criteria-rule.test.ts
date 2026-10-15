import { expect, test } from "bun:test";
import { CRITERIA } from "@/lib/test-criteria";
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

const everything = { groups: true, items: true };
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
  expect(cheap).not.toContain("warning_points_below");
  expect(cheap.length).toBe(CRITERIA.length - 1);
  for (const place of ["notice", "shopCategory", "shopItem"] as const) {
    expect(PLACES[place].cheapOnly).toBe(true);
    expect(ids(place)).toEqual(cheap);
  }
});

test("a criterion that needs a group or a shop item is not offered when there is none to choose", () => {
  const without = ids("promotion", { groups: false, items: false });
  expect(without).not.toContain("in_group");
  expect(without).not.toContain("not_in_group");
  expect(without).not.toContain("purchased_item");
  expect(without).toContain("is_member");
  expect(ids("promotion", { groups: true, items: false })).toContain(
    "in_group",
  );
});

test("an empty rule means everyone, manual only for an award, and is refused for a promotion", () => {
  expect(PLACES.promotion.empty).toBe("required");
  expect(PLACES.award.empty).toBe("manual");
  for (const place of ["notice", "shopCategory", "shopItem"] as const)
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
  const [post, avatar, group] = ["post_count", "has_avatar", "in_group"].map(
    find,
  );
  const draft = [post, avatar, group, post].reduce(
    (now, criterion) => addCondition(now, criterion as Criterion),
    start,
  );
  expect(ruleOfDraft(draft).conditions).toEqual([
    { criterion: "post_count" },
    { criterion: "has_avatar", value: 1 },
    { criterion: "in_group" },
    { criterion: "post_count" },
  ]);
  expect(new Set(draft.entries.map((entry) => entry.key)).size).toBe(4);
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
  // Background in a notice: kept, not drawn.
  expect(
    controlFor({ criterion: "warning_points_below", value: 3 }, offered),
  ).toBeNull();
});

test("a typed number is a whole number or nothing", () => {
  expect(numberOf(" 12 ")).toBe(12);
  expect(numberOf("0")).toBe(0);
  for (const bad of ["", "-1", "1.5", "1e3", "x", "12345678901"])
    expect(numberOf(bad)).toBeUndefined();
});
