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

const GROUPS = [{ id: 7, title: "Writers" }];

test("the rule is edited with what criteria.list gives, and the shop's items", async () => {
  backend = fakeBackend({
    "auth.me": () => Response.json(viewerBody(true)),
    "criteria.list": () =>
      Response.json({ items: CRITERIA_BODY, groups: GROUPS }),
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
  // One read for the criteria and the groups, none of the older ones.
  expect(operations()).toContain("criteria.list");
  expect(operations()).toContain("shopCategories.list");
  for (const old of ["awards.criteria", "promotions.criteria", "groups.list"])
    expect(operations()).not.toContain(old);
});

test("with no groups the group criteria are not offered", async () => {
  backend = fakeBackend({
    "auth.me": () => Response.json(viewerBody(true)),
    "criteria.list": () => Response.json({ items: CRITERIA_BODY, groups: [] }),
    "shopCategories.list": () => Response.json({ items: [] }),
  });
  const html = await draw();
  expect(html).toContain('<option value="post_count"');
  expect(html).not.toContain('<option value="in_group"');
});

test("the builder is keyed by the place, the record and the rule, so another record starts afresh", async () => {
  backend = fakeBackend({
    "auth.me": () => Response.json(viewerBody(true)),
    "criteria.list": () => Response.json({ items: CRITERIA_BODY, groups: [] }),
    "shopCategories.list": () => Response.json({ items: [] }),
  });
  const one: Rule = {
    match: "all",
    conditions: [{ criterion: "is_guest", value: 1 }],
  };
  const other: Rule = { match: "all", conditions: [] };
  const keyOf = async (
    owner: number | undefined,
    rule: Rule,
    place: "shopCategory" | "notice" = "shopCategory",
  ) => {
    const row = (await RuleField({ place, owner, rule })) as {
      props: { children: { key: string } };
    };
    return row.props.children.key;
  };
  const keys = [
    await keyOf(2, one),
    await keyOf(3, one),
    await keyOf(2, other),
    await keyOf(undefined, one),
    await keyOf(2, one, "notice"),
  ];
  // Every difference gives a new builder; the same inputs give the same one.
  expect(new Set(keys).size).toBe(keys.length);
  expect(await keyOf(2, one)).toBe(keys[0] as string);
});

test("a viewer the backend refuses gets no editor", async () => {
  backend = fakeBackend({
    "auth.me": () => Response.json(viewerBody(true)),
    "criteria.list": refused,
    "shopCategories.list": () => Response.json({ items: [] }),
  });
  await expect(draw()).rejects.toMatchObject({ code: "forbidden" });
});
