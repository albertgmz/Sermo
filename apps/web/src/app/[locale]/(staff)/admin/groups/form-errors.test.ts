import { afterAll, expect, mock, test } from "bun:test";
import { messages } from "@/i18n/messages";
import { translator } from "@/lib/test-intl";

mock.module("server-only", () => ({}));
const intl = await import("next-intl/server");
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async (namespace: string) => translator(namespace),
}));
const { orderRefusal, ruleOf, ruleRefusal } = await import("./form-errors");

afterAll(() => {
  mock.module("next-intl/server", () => intl);
});

test("a refusal part-way names the row and counts what was saved", () => {
  expect(orderRefusal(1, 3, "Rules", "Not allowed.")).toEqual({
    key: "partial",
    values: { saved: 1, total: 3, title: "Rules", message: "Not allowed." },
  });
});

test("a refusal of the first change says that nothing was saved", () => {
  expect(orderRefusal(0, 2, "Home", "Not allowed.").key).toBe("none");
});

const form = (rule?: string) => {
  const data = new FormData();
  if (rule !== undefined) data.append("rule", rule);
  return data;
};

test("a rule goes through the form field and comes back unchanged, in order", () => {
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
    { match: "all" as const, conditions: [] },
  ];
  for (const rule of rules)
    expect(ruleOf(form(JSON.stringify(rule)))).toEqual(rule);
});

test("anything that is not a rule is null", () => {
  expect(ruleOf(form())).toBeNull();
  expect(ruleOf(form("{broken"))).toBeNull();
  expect(ruleOf(form("[]"))).toBeNull();
  expect(ruleOf(form('{"match":"all"}'))).toBeNull();
  expect(ruleOf(form('{"match":"most","conditions":[]}'))).toBeNull();
  expect(ruleOf(form('{"match":"all","conditions":[{"value":1}]}'))).toBeNull();
});

test("a rule over a schema limit is told apart from a form that sent no rule", async () => {
  const many = Array.from({ length: 21 }, () => ({
    criterion: "post_count",
    value: 1,
  }));
  const limited = [
    JSON.stringify({
      match: "all",
      conditions: [{ criterion: "post_count", value: 2_000_000_000 }],
    }),
    JSON.stringify({ match: "all", conditions: many }),
  ];
  for (const sent of limited) {
    expect(ruleOf(form(sent))).toBeNull();
    expect(await ruleRefusal(form(sent))).toEqual({
      fields: { rule: messages.adminGroups.errors.ruleLimits },
    });
  }
  for (const sent of [undefined, "{broken", "[]", "null", '{"match":"all"}'])
    expect(await ruleRefusal(form(sent))).toEqual({
      fields: { rule: messages.adminGroups.errors.rule },
    });
  // The limit message names the numbers of the shared schema.
  expect(messages.adminGroups.errors.ruleLimits).toContain("{conditions}");
});
