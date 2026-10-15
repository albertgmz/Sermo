import { expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));
const { orderRefusal, ruleOf } = await import("./form-errors");

test("a refusal part-way names the row and counts what was saved", () => {
  expect(orderRefusal(1, 3, "Rules", "Not allowed.")).toEqual({
    key: "partial",
    values: { saved: 1, total: 3, title: "Rules", message: "Not allowed." },
  });
});

test("a refusal of the first change says that nothing was saved", () => {
  expect(orderRefusal(0, 2, "Home", "Not allowed.").key).toBe("none");
});

const form = (entries: [string, string][]) => {
  const data = new FormData();
  for (const [name, value] of entries) data.append(name, value);
  return data;
};

test("a rule is read from the offered ids that are ticked, with whole values", () => {
  const offered = [{ id: "a" }, { id: "b" }, { id: "c" }];
  expect(
    ruleOf(
      offered,
      form([
        ["use:a", "on"],
        ["value:a", " 5 "],
        ["value:b", "9"],
        ["use:c", "on"],
        ["value:c", "0"],
        ["use:invented", "on"],
        ["value:invented", "1"],
      ]),
    ),
  ).toEqual({
    match: "all",
    conditions: [
      { criterion: "a", value: 5 },
      { criterion: "c", value: 0 },
    ],
  });
  expect(
    ruleOf(
      offered,
      form([
        ["use:a", "on"],
        ["value:a", "x"],
      ]),
    ),
  ).toBeNull();
  expect(ruleOf(offered, form([["use:a", "on"]]))).toBeNull();
});

test("how the rule matches and the conditions the form does not draw are kept", () => {
  const offered = [{ id: "a" }, { id: "in_group", kind: "groups" as const }];
  const kept = [{ criterion: "in_group", ids: [3] }];
  expect(
    ruleOf(
      offered,
      form([
        ["rule:match", "any"],
        ["rule:kept", JSON.stringify(kept)],
        ["use:a", "on"],
        ["value:a", "2"],
        // A criterion the form does not draw is never read from its own fields.
        ["use:in_group", "on"],
        ["value:in_group", "1"],
      ]),
    ),
  ).toEqual({
    match: "any",
    conditions: [{ criterion: "a", value: 2 }, ...kept],
  });
  expect(
    ruleOf(
      offered,
      form([
        ["rule:match", "other"],
        ["rule:kept", "{broken"],
      ]),
    ),
  ).toEqual({
    match: "all",
    conditions: [],
  });
});

test("a rule made through the API goes through the form and comes back unchanged", async () => {
  const { drawnValues, undrawn } = await import(
    "@/components/staff/criteria-rule"
  );
  const definitions = [
    { id: "post_count", kind: "atLeast" as const },
    { id: "has_avatar", kind: "boolean" as const },
    { id: "in_group", kind: "groups" as const },
  ];
  const rules = [
    {
      match: "any" as const,
      conditions: [
        { criterion: "post_count", value: 5 },
        { criterion: "post_count", value: 100 },
        { criterion: "in_group", ids: [3] },
        { criterion: "made_up", value: 1 },
        { criterion: "has_avatar", value: 0 },
      ],
    },
    {
      match: "all" as const,
      conditions: [
        { criterion: "post_count", ids: [1] },
        { criterion: "post_count", value: 7 },
      ],
    },
  ];
  for (const rule of rules) {
    // What the form puts in its fields for this rule, as a browser would send them back.
    const sent: [string, string][] = [
      ["rule:match", rule.match],
      ["rule:kept", JSON.stringify(undrawn(rule, definitions))],
    ];
    for (const [id, value] of drawnValues(rule)) {
      sent.push([`use:${id}`, "on"], [`value:${id}`, String(value)]);
    }
    const saved = ruleOf(definitions, form(sent));
    expect(saved?.match).toBe(rule.match);
    const key = (entry: object) => JSON.stringify(entry);
    expect(saved?.conditions.map(key).sort()).toEqual(
      rule.conditions.map(key).sort(),
    );
  }
});
