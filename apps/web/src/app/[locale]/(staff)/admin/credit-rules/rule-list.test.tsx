import { afterAll, afterEach, expect, test } from "bun:test";
import { messages } from "@/i18n/messages";
import { creditRulesBody } from "@/lib/test-bodies";
import { viewerBody } from "@/lib/test-viewer";
import { htmlOf, mockIntl, redirectedTo } from "../credits/test-render";
import { fakeBackend } from "../groups/test-backend";

const restore = await mockIntl();
const { RuleList } = await import("./rule-list");

let backend: ReturnType<typeof fakeBackend> | undefined;
afterEach(() => backend?.restore());
afterAll(restore);

const RULE = {
  id: 1,
  title: "Posting pays",
  trigger: "reply_posted",
  amount: 5,
  isActive: true,
  limit: { count: 10, windowHours: 24 },
  nodeIds: [3],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function list(rules: unknown[], search: Record<string, string> = {}) {
  backend = fakeBackend({
    "auth.me": () => Response.json(viewerBody(false)),
    "creditRules.list": () => Response.json(creditRulesBody(rules)),
    "nodes.list": () => Response.json({ items: [], nextCursor: null }),
  });
  return RuleList({
    searchParams: Promise.resolve(search),
    addAction: <a href="/admin/credit-rules/new">Add</a>,
  });
}

const text = messages.adminEconomy.rules;

test("each rule is a row leading to its own page, with what it does", async () => {
  const html = await htmlOf(
    await list([
      RULE,
      { ...RULE, id: 2, title: "Spam costs", amount: -3, isActive: false },
    ]),
  );
  for (const id of [1, 2])
    expect(html).toContain(`href="/admin/credit-rules/${id}"`);
  expect(html).toContain("Edit Posting pays");
  expect(html).toContain(text.triggers.reply_posted);
  expect(html).toContain("+5");
  expect(html).toContain("-3");
  expect(html).toContain("at most 10 per 24 h");
  expect(html).toContain("only in #3");
  expect(html).toContain(text.inactive);
});

test("each row keeps its delete step, which posts the rule's id", async () => {
  const html = await htmlOf(await list([RULE]));
  expect(html).toContain(text.deleteShort);
  expect(html).toContain('name="id" value="1"');
  expect(html).toContain(text.deleteWarning);
});

test("with no rules the list offers to add one", async () => {
  const html = await htmlOf(await list([]));
  expect(html).toContain(text.none);
  expect(html).toContain('href="/admin/credit-rules/new"');
});

test("the address the editor used to open at goes to the rule's page", async () => {
  const to = await redirectedTo(async () => list([RULE], { edit: "1" }));
  expect(to).toMatch(/;\/admin\/credit-rules\/1;/);
  const none = await redirectedTo(async () => list([RULE], { edit: "9" }));
  expect(none).toBeUndefined();
});
