import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CRITERIA, LIMITS } from "@/lib/test-criteria";
import { withIntl } from "@/lib/test-intl";
import { PLACES, type Place, type Rule } from "./criteria-rule";

const { RuleBuilder } = await import("./rule-builder");

const choices = {
  groups: [
    { id: 3, label: "Moderators" },
    { id: 4, label: "Veterans" },
  ],
  items: [{ id: 8, label: "Shop: Golden frame" }],
  members: [{ id: 5, label: "ember" }],
  threads: [{ id: 21, label: "Welcome thread" }],
  awards: [{ id: 2, label: "Veteran" }],
  shopCategories: [{ id: 3, label: "Frames" }],
  creditRules: [{ id: 6, label: "Daily visit" }],
};
const nothing: Rule = { match: "all", conditions: [] };

function draw(place: Place, rule: Rule = nothing, over = {}) {
  return renderToStaticMarkup(
    withIntl(
      <RuleBuilder
        place={place}
        criteria={CRITERIA}
        rule={rule}
        choices={{ ...choices, ...over }}
        limits={LIMITS}
        findMembers={async () => []}
        findThreads={async () => []}
      />,
    ),
  );
}

// The criteria in the "Add a condition" list.
function addable(html: string) {
  const select = /<select aria-label="Add a condition"[\s\S]*?<\/select>/.exec(
    html,
  )?.[0];
  return [...(select ?? "").matchAll(/<option value="(\w+)"/g)]
    .map((match) => match[1])
    .filter((value) => value !== "");
}

// The rule the form would send, read back from the hidden field.
function sent(html: string): Rule {
  const value = /<input type="hidden" name="rule" value="([^"]*)"/.exec(
    html,
  )?.[1];
  return JSON.parse((value ?? "").replaceAll("&quot;", '"'));
}

const places = Object.keys(PLACES) as Place[];

test("every place offers each criterion it allows, and notices and the shop hide the background ones", () => {
  for (const place of places) {
    const expected = CRITERIA.filter(
      (entry) => !PLACES[place].cheapOnly || entry.cost === "cheap",
    ).map((entry) => entry.id);
    expect(addable(draw(place))).toEqual(expected);
  }
  for (const place of ["notice", "shopCategory", "shopItem"] as const)
    expect(addable(draw(place))).not.toContain("warning_points_below");
  expect(addable(draw("promotion"))).toContain("warning_points_below");
  expect(addable(draw("award"))).toContain("warning_points_below");
});

test("without groups to choose from, the group criteria are not offered", () => {
  const list = addable(draw("notice", nothing, { groups: [] }));
  expect(list).not.toContain("in_group");
  expect(list).not.toContain("not_in_group");
  expect(list).toContain("is_member");
});

test("without awards, credit rules, shop categories or items, the criteria that need them are not offered", () => {
  const list = addable(
    draw("promotion", nothing, {
      awards: [],
      creditRules: [],
      shopCategories: [],
      items: [],
    }),
  );
  for (const id of [
    "holds_awards",
    "credits_from_rule",
    "bought_in_category",
    "owns_item",
    "wears_item",
    "purchased_item",
  ])
    expect(list, id).not.toContain(id);
  // Threads are searched, so they are always there to choose.
  expect(list).toContain("posts_in_threads");
});

test("a list condition draws its chosen names, a number, the mode and the window it takes", () => {
  const html = draw("promotion", {
    match: "all",
    conditions: [
      { criterion: "posts_in_threads", ids: [21, 99], value: 4, mode: "all" },
      { criterion: "credits_earned", value: 50, days: 30 },
      { criterion: "holds_awards", ids: [2], mode: "none" },
      { criterion: "bought_in_category", ids: [3], mode: "each" },
      { criterion: "credits_from_rule", ids: [6], value: 9 },
    ],
  });
  // Threads by title, and one the page has no name for by its number.
  expect(html).toContain("Welcome thread");
  expect(html).toContain("#99");
  // Awards, shop categories and credit rules by name.
  expect(html).toContain("Veteran");
  expect(html).toContain("Frames");
  expect(html).toContain("Daily visit");
  // The mode select shows the condition's own mode, among the modes its criterion lists.
  expect(html).toContain(
    '<option value="all" selected="">All of them added together</option>',
  );
  expect(html).toContain(
    '<option value="none" selected="">None of them</option>',
  );
  expect(html).toContain(
    '<option value="each" selected="">Each of them</option>',
  );
  // A criterion with no mode to choose draws no mode select.
  expect(html.split(': How the list is read"').length - 1).toBe(4);
  // Each says which condition it belongs to, so two list conditions can be told apart.
  expect(html).toContain(
    'aria-label="Title of posts_in_threads: How the list is read"',
  );
  expect(html).toContain(
    'aria-label="Title of holds_awards: How the list is read"',
  );
  // A window: its number, only where the criterion takes one.
  expect(html).toContain(
    'aria-label="Title of credits_earned: Look back this many days"',
  );
  expect(html).toMatch(/: Look back this many days"[^>]*value="30"/);
  expect(html.split(': Look back this many days"').length - 1).toBe(2);
  expect(html).toContain(`max="${LIMITS.days}"`);
});

test("a rule with the new conditions is sent back as it was, in order", () => {
  const rule: Rule = {
    match: "any",
    conditions: [
      { criterion: "posts_in_threads", ids: [21], value: 2, mode: "each" },
      {
        criterion: "credits_from_rule",
        ids: [6],
        value: 9,
        days: 7,
        mode: "one",
      },
      { criterion: "holds_awards", ids: [2, 3] },
      { criterion: "credits_earned", value: 1 },
    ],
  };
  expect(sent(draw("award", rule))).toEqual(rule);
});

test("an empty rule says who it covers in plain words", () => {
  expect(draw("notice")).toContain("Everyone.");
  expect(draw("shopItem")).toContain("Everyone.");
  expect(draw("award")).toContain("Manual only");
  expect(draw("promotion")).toContain("needs at least one condition");
  expect(sent(draw("promotion"))).toEqual(nothing);
});

test("two conditions of one criterion are drawn twice and sent back in order", () => {
  const rule: Rule = {
    match: "any",
    conditions: [
      { criterion: "post_count", value: 5 },
      { criterion: "post_count", value: 100 },
    ],
  };
  const html = draw("promotion", rule);
  expect(html.split("Title of post_count</p>").length - 1).toBe(2);
  expect(html).toContain('value="5"');
  expect(html).toContain('value="100"');
  expect(sent(html)).toEqual(rule);
});

test("the match switch appears with two conditions and shows the rule's own choice", () => {
  const one: Rule = {
    match: "any",
    conditions: [{ criterion: "post_count", value: 5 }],
  };
  expect(draw("award", one)).not.toContain('type="radio"');
  // A rule of one condition that says any is sent back as it was.
  expect(sent(draw("award", one))).toEqual(one);
  const two: Rule = {
    match: "any",
    conditions: [...one.conditions, { criterion: "has_avatar", value: 1 }],
  };
  const html = draw("award", two);
  expect(html.match(/type="radio"/g)?.length).toBe(2);
  expect(html).toMatch(/type="radio"[^>]*checked=""[^>]*\/>Any of these/);
  expect(html).toContain("All of these");
});

test("each condition draws the input its criterion asks for", () => {
  const html = draw("promotion", {
    match: "all",
    conditions: [
      { criterion: "days_registered", value: 30 },
      { criterion: "has_avatar", value: 0 },
      { criterion: "in_group", ids: [3, 99] },
      { criterion: "purchased_item", value: 8 },
      { criterion: "is_member", ids: [5] },
    ],
  });
  // A number with its kind and unit.
  expect(html).toMatch(
    /At least[\s\S]*type="number"[^>]*value="30"[\s\S]*days/,
  );
  // Yes/no.
  expect(html).toContain(
    '<option value="0" selected="">Must not hold</option>',
  );
  // Chosen groups by name, and an id the list does not have by its number.
  expect(html).toContain("Moderators");
  expect(html).toContain("#99");
  // The shop item and the member by name.
  expect(html).toContain("Shop: Golden frame");
  expect(html).toContain("ember");
  // Each one can be removed.
  expect(html.match(/aria-label="Remove /g)?.length).toBeGreaterThanOrEqual(5);
});

test("a rule stops taking conditions at the schema's limit", () => {
  const conditions = (count: number) =>
    Array.from({ length: count }, () => ({
      criterion: "post_count",
      value: 1,
    }));
  const room = draw("promotion", {
    match: "all",
    conditions: conditions(LIMITS.conditions - 1),
  });
  expect(room).toContain('aria-label="Add a condition"');
  expect(room).not.toContain("takes at most");
  const full = draw("promotion", {
    match: "all",
    conditions: conditions(LIMITS.conditions),
  });
  expect(full).not.toContain('aria-label="Add a condition"');
  expect(full).toContain(`takes at most ${LIMITS.conditions} conditions`);
});

test("a number field stops at the schema's limit", () => {
  const html = draw("award", {
    match: "all",
    conditions: [{ criterion: "post_count", value: 3 }],
  });
  expect(html).toContain(`max="${LIMITS.value}"`);
});

test("a condition the builder does not draw is shown as it is and sent back unchanged", () => {
  const rule: Rule = {
    match: "all",
    conditions: [
      { criterion: "made_up", value: 4 },
      { criterion: "warning_points_below", value: 3 },
      { criterion: "post_count", ids: [1, 2] },
    ],
  };
  const html = draw("notice", rule);
  expect(html.match(/Not edited here, saved as it is/g)?.length).toBe(3);
  expect(sent(html)).toEqual(rule);
});
