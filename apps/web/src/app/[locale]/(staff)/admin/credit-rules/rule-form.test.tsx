import { afterAll, expect, test } from "bun:test";
import { creditRulesBody } from "@/lib/test-bodies";
import { htmlOf, mockIntl } from "../credits/test-render";

const restore = await mockIntl();
const { RuleFormFields } = await import("./rule-form");
afterAll(restore);

const { triggers } = creditRulesBody() as {
  triggers: Parameters<typeof RuleFormFields>[0]["triggers"];
};
const RULE: NonNullable<Parameters<typeof RuleFormFields>[0]["rule"]> = {
  id: 4,
  title: "Posting pays",
  trigger: "reply_posted",
  amount: 5,
  isActive: false,
  limit: { count: 10, windowHours: 24 },
  nodeIds: [],
  filters: {
    createdFrom: null,
    createdUntil: null,
    minLength: null,
    maxLength: null,
  },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

test("a new rule has no id, chooses its trigger and starts active", async () => {
  const html = await htmlOf(await RuleFormFields({ triggers, nodes: [] }));
  expect(html).not.toContain('name="id"');
  expect(html).toContain('<select id="rule-new-trigger" name="trigger"');
  expect(html).toMatch(/name="isActive"[^>]*checked/);
});

test("an existing rule posts its id, keeps its trigger and shows what it holds", async () => {
  const html = await htmlOf(
    await RuleFormFields({ rule: RULE, triggers, nodes: [] }),
  );
  expect(html).toContain('name="id" value="4"');
  expect(html).toContain(
    '<input type="hidden" name="trigger" value="reply_posted"',
  );
  expect(html).not.toContain("<select");
  expect(html).toContain('value="Posting pays"');
  expect(html).toContain('name="limitCount"');
  expect(html).toContain('value="24"');
  expect(html).not.toMatch(/name="isActive"[^>]*checked/);
});

test("an existing rule's filters are in the form, and a new one has none", async () => {
  const filterable = triggers.map((trigger) => ({
    ...trigger,
    acceptsFilters: trigger.id === "reply_posted",
  }));
  const html = await htmlOf(
    await RuleFormFields({
      rule: {
        ...RULE,
        filters: {
          createdFrom: "2020-01-01",
          createdUntil: "2024-12-31",
          minLength: null,
          maxLength: 500,
        },
      },
      triggers: filterable,
      nodes: [],
    }),
  );
  expect(html).toMatch(/name="createdFrom"[^>]*value="2020-01-01"/);
  expect(html).toMatch(/name="createdUntil"[^>]*value="2024-12-31"/);
  expect(html).toMatch(/name="maxLength"[^>]*value="500"/);
  expect(html).not.toMatch(/name="minLength"[^>]*value=/);
});
