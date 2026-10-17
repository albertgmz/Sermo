import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { renderToReadableStream } from "react-dom/server";
import { fakeBackend } from "@/app/[locale]/(staff)/admin/groups/test-backend";
import { groupBody } from "@/lib/test-bodies";
import { CRITERIA_BODY } from "@/lib/test-criteria";
import { translator, withIntl } from "@/lib/test-intl";
import { viewerBody } from "@/lib/test-viewer";

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
const { PromotionForm } = await import("./promotion-form");

let backend: ReturnType<typeof fakeBackend> | undefined;
afterEach(() => backend?.restore());
afterAll(() => {
  mock.module("next-intl/server", () => intl);
});

async function form(
  promotion?: Parameters<typeof PromotionForm>[0]["promotion"],
) {
  backend = fakeBackend({
    "auth.me": () => Response.json(viewerBody(true)),
    "groups.list": () =>
      Response.json({ items: [groupBody({ id: 7, title: "Writers" })] }),
    "criteria.list": () =>
      Response.json({
        items: CRITERIA_BODY,
        groups: [{ id: 7, title: "Writers" }],
        awards: [],
        creditRules: [],
        reactionTypes: [],
      }),
    "shopCategories.list": () => Response.json({ items: [] }),
  });
  const stream = await renderToReadableStream(
    withIntl(await PromotionForm({ promotion })),
  );
  await stream.allReady;
  return new Response(stream).text();
}

const names = (html: string) =>
  [...html.matchAll(/<(?:input|textarea)[^>]*? name="([^"]+)"/g)].map(
    (match) => match[1],
  );

test("the promotion form sends every field the save action reads", async () => {
  const html = await form({
    id: 3,
    title: "Regulars",
    isActive: true,
    rule: { match: "all", conditions: [] },
    groupIds: [7],
  } as never);
  for (const name of [
    "id",
    "title",
    "isActive",
    "rule",
    "groupIds",
    "actorPassword",
  ])
    expect(names(html), name).toContain(name);
  expect(html).toContain("Writers");
});

test("a new promotion carries no id and starts active", async () => {
  const html = await form();
  expect(names(html)).not.toContain("id");
  expect(html).toMatch(/<input[^>]*id="promotion-active"[^>]*checked/);
  expect(html).toContain("Create promotion");
});
