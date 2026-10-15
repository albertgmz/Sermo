import { expect, test } from "bun:test";
import { audienceOf, ruleOfAudience } from "./audience";

test("each simple audience is one rule and reads back as itself", () => {
  expect(ruleOfAudience("everyone", null)).toEqual({
    match: "all",
    conditions: [],
  });
  expect(ruleOfAudience("guests", null).conditions).toEqual([
    { criterion: "is_guest", value: 1 },
  ]);
  expect(ruleOfAudience("members", null).conditions).toEqual([
    { criterion: "is_guest", value: 0 },
  ]);
  expect(ruleOfAudience("group", 7).conditions).toEqual([
    { criterion: "in_group", ids: [7] },
  ]);
  for (const [audience, groupId] of [
    ["everyone", null],
    ["guests", null],
    ["members", null],
    ["group", 7],
  ] as const)
    expect(audienceOf(ruleOfAudience(audience, groupId))).toEqual({
      audience,
      groupId,
    });
});

test("any other rule is custom", () => {
  const custom = [
    {
      match: "all" as const,
      conditions: [{ criterion: "is_member", ids: [1] }],
    },
    {
      match: "all" as const,
      conditions: [{ criterion: "in_group", ids: [1, 2] }],
    },
    {
      match: "all" as const,
      conditions: [{ criterion: "is_guest", value: 2 }],
    },
    {
      match: "any" as const,
      conditions: [
        { criterion: "is_guest", value: 1 },
        { criterion: "in_group", ids: [3] },
      ],
    },
  ];
  for (const rule of custom) expect(audienceOf(rule).audience).toBe("custom");
});
