import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  CATEGORY,
  ITEM,
} from "@/app/[locale]/(staff)/admin/credits/test-fixtures";
import {
  fakeBackend,
  refusal,
} from "@/app/[locale]/(staff)/admin/groups/test-backend";
import { groupBody } from "@/lib/test-bodies";
import { CRITERIA_BODY } from "@/lib/test-criteria";
import { translator, withIntl } from "@/lib/test-intl";
import { viewerBody } from "@/lib/test-viewer";
import type { Rule } from "./criteria-rule";

mock.module("server-only", () => ({}));
mock.module("@/app/[locale]/(main)/conversations/actions", () => ({
  findRecipients: async () => [],
}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, toString: () => "" }),
}));
const intl = await import("next-intl/server");
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async (namespace: string) => translator(namespace),
}));
const { RuleField } = await import("./rule-field");

let backend: ReturnType<typeof fakeBackend> | undefined;
afterEach(() => backend?.restore());
afterAll(() => {
  mock.module("next-intl/server", () => intl);
});

const refused = () => refusal(403, "forbidden", "No.");
const operations = () => backend?.asked.map((call) => call.operation);
const draw = async (rule?: Rule) =>
  renderToStaticMarkup(withIntl(await RuleField({ place: "shopItem", rule })));

test("the rule is edited with what the backend lists, the groups and the shop's items", async () => {
  backend = fakeBackend({
    "auth.me": () => Response.json(viewerBody(true)),
    "awards.criteria": () => Response.json({ items: CRITERIA_BODY }),
    "groups.list": () => Response.json({ items: [groupBody()] }),
    "shopCategories.list": () => Response.json({ items: [CATEGORY] }),
    "shopItems.list": () => Response.json({ items: [ITEM], nextCursor: null }),
  });
  const html = await draw({
    match: "all",
    conditions: [
      { criterion: "in_group", ids: [7] },
      { criterion: "purchased_item", value: 5 },
    ],
  });
  expect(html).toContain("Available to");
  expect(html).toContain("Writers");
  expect(html).toContain("Goodies: Item");
  // The shop takes cheap criteria only.
  expect(html).not.toContain("Title of warning_points_below");
  expect(html).toContain('value="in_group"');
  expect(operations()).not.toContain("promotions.criteria");
});

test("a viewer who may not read the awards' list is given the promotions' list", async () => {
  backend = fakeBackend({
    "auth.me": () => Response.json(viewerBody(true)),
    "awards.criteria": refused,
    "promotions.criteria": () => Response.json({ items: CRITERIA_BODY }),
    "groups.list": refused,
    "shopCategories.list": () => Response.json({ items: [] }),
  });
  const html = await draw();
  expect(operations()).toContain("promotions.criteria");
  expect(html).toContain('<option value="post_count"');
  // Without the group list no group criterion is offered.
  expect(html).not.toContain('<option value="in_group"');
});

test("a viewer who may read neither list gets the rule back unchanged in a hidden field", async () => {
  backend = fakeBackend({
    "auth.me": () => Response.json(viewerBody(true)),
    "awards.criteria": refused,
    "promotions.criteria": refused,
  });
  const rule: Rule = {
    match: "any",
    conditions: [
      { criterion: "post_count", value: 5 },
      { criterion: "post_count", value: 9 },
    ],
  };
  const html = await draw(rule);
  expect(html).toContain("not open to you");
  expect(html).toContain(
    `name="rule" value="${JSON.stringify(rule).replaceAll('"', "&quot;")}"`,
  );
  expect(html).not.toContain("<select");
  // Nothing else was asked for: no groups, no items.
  expect(operations()).not.toContain("groups.list");
});
