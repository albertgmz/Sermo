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
      Response.json({
        items: CRITERIA_BODY,
        groups: GROUPS,
        awards: [],
        creditRules: [],
      }),
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

const when = "2026-01-01T00:00:00.000Z";
const someone = { id: 3, username: "ember" };
const THREAD_ANSWER = {
  thread: {
    id: 31,
    nodeId: 2,
    node: { id: 2, title: "Forum" },
    title: "Rules of the house",
    prefix: null,
    excerpt: "",
    cover: null,
    highlightedUntil: null,
    bumpedAt: null,
    author: someone,
    state: "visible",
    isSticky: false,
    isLocked: false,
    createdAt: when,
    replyCount: 0,
    viewCount: 0,
    firstPostId: 1,
    lastPost: { postId: 1, position: 0, postedAt: when, user: someone },
    readPosition: null,
    isUnread: false,
  },
  seo: {
    title: "t",
    description: "d",
    canonical: "https://example.test/threads/31",
    robots: "index,follow",
    redirect: false,
    jsonLd: [],
  },
  node: { id: 2, title: "Forum" },
  watching: null,
  permissions: {
    canReply: false,
    canEditTitle: false,
    canModerate: false,
    canReport: false,
    canRemoveCover: false,
    canWatch: false,
  },
  resolvedPermissions: {},
};

test("the awards, credit rules and shop categories a rule names are shown by name", async () => {
  backend = fakeBackend({
    "auth.me": () => Response.json(viewerBody(true)),
    "criteria.list": () =>
      Response.json({
        items: CRITERIA_BODY,
        groups: [],
        awards: [{ id: 4, title: "Veteran" }],
        creditRules: [{ id: 9, title: "Daily visit" }],
      }),
    "shopCategories.list": () => Response.json({ items: [CATEGORY] }),
    "shopItems.list": () => Response.json({ items: [ITEM], nextCursor: null }),
  });
  const html = await draw({
    match: "all",
    conditions: [
      { criterion: "holds_awards", ids: [4], mode: "none" },
      { criterion: "bought_in_category", ids: [CATEGORY.id], mode: "one" },
    ],
  });
  expect(html).toContain("Veteran");
  expect(html).toContain(CATEGORY.name);
  // The shop takes cheap criteria only: the awards and the category criteria are cheap, the
  // credit rule one is not.
  expect(html).toContain('<option value="holds_awards"');
  expect(html).toContain('<option value="bought_in_category"');
  expect(html).not.toContain('<option value="credits_from_rule"');
  const promotion = renderToStaticMarkup(
    withIntl(await RuleField({ place: "promotion" })),
  );
  expect(promotion).toContain('<option value="credits_from_rule"');
});

test("the threads a rule names are shown by title, one the viewer cannot see by its number", async () => {
  backend = fakeBackend({
    "auth.me": () => Response.json(viewerBody(true)),
    "criteria.list": () =>
      Response.json({
        items: CRITERIA_BODY,
        groups: [],
        awards: [],
        creditRules: [],
      }),
    "shopCategories.list": () => Response.json({ items: [] }),
    "threads.get": () => Response.json(THREAD_ANSWER),
  });
  const rule: Rule = {
    match: "all",
    conditions: [{ criterion: "posts_in_threads", ids: [31], value: 2 }],
  };
  const html = renderToStaticMarkup(
    withIntl(await RuleField({ place: "promotion", rule })),
  );
  expect(html).toContain("Rules of the house");
  expect(operations()?.filter((name) => name === "threads.get")).toHaveLength(
    1,
  );
  backend.restore();
  backend = fakeBackend({
    "auth.me": () => Response.json(viewerBody(true)),
    "criteria.list": () =>
      Response.json({
        items: CRITERIA_BODY,
        groups: [],
        awards: [],
        creditRules: [],
      }),
    "shopCategories.list": () => Response.json({ items: [] }),
    "threads.get": () => refusal(404, "not_found", "No."),
  });
  const hidden = renderToStaticMarkup(
    withIntl(await RuleField({ place: "promotion", rule })),
  );
  expect(hidden).toContain("#31");
  expect(hidden).not.toContain("Rules of the house");
});

test("with no groups the group criteria are not offered", async () => {
  backend = fakeBackend({
    "auth.me": () => Response.json(viewerBody(true)),
    "criteria.list": () =>
      Response.json({
        items: CRITERIA_BODY,
        groups: [],
        awards: [],
        creditRules: [],
      }),
    "shopCategories.list": () => Response.json({ items: [] }),
  });
  const html = await draw();
  expect(html).toContain('<option value="post_count"');
  expect(html).not.toContain('<option value="in_group"');
});

test("the builder is keyed by the place, the record and the rule, so another record starts afresh", async () => {
  backend = fakeBackend({
    "auth.me": () => Response.json(viewerBody(true)),
    "criteria.list": () =>
      Response.json({
        items: CRITERIA_BODY,
        groups: [],
        awards: [],
        creditRules: [],
      }),
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
