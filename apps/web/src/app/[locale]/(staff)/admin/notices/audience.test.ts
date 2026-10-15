import { expect, test } from "bun:test";
import { audienceOf } from "./audience";

test("the four simple audiences read as themselves", () => {
  const read = (conditions: object[]) =>
    audienceOf({ match: "all", conditions: conditions as never });
  expect(read([])).toEqual({ audience: "everyone", groupId: null });
  expect(read([{ criterion: "is_guest", value: 1 }])).toEqual({
    audience: "guests",
    groupId: null,
  });
  expect(read([{ criterion: "is_guest", value: 0 }])).toEqual({
    audience: "members",
    groupId: null,
  });
  expect(read([{ criterion: "in_group", ids: [7] }])).toEqual({
    audience: "group",
    groupId: 7,
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
