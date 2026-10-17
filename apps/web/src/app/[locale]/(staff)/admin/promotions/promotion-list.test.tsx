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
// Another suite may leave a stand-in for `useTranslations` in place: the client components here
// read the real messages.
const nextIntl = { ...(await import("next-intl")) };
const useIntl = await import("use-intl");
mock.module("next-intl", () => ({
  ...nextIntl,
  useLocale: () => "en",
  useTranslations: useIntl.useTranslations,
}));
const { PromotionList } = await import("./promotion-list");

let backend: ReturnType<typeof fakeBackend> | undefined;
afterEach(() => backend?.restore());
afterAll(() => {
  mock.module("next-intl", () => nextIntl);
  mock.module("next-intl/server", () => intl);
});

const PROMOTION = {
  id: 3,
  title: "Regulars",
  isActive: true,
  rule: {
    match: "all",
    conditions: [{ criterion: CRITERIA_BODY[0].id, value: 50 }],
  },
  groupIds: [7],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

async function page(promotions: unknown[], mayOpenLog: boolean) {
  backend = fakeBackend({
    "auth.me": () =>
      Response.json({
        ...viewerBody(true),
        resolvedPermissions: { "admin.promotions": mayOpenLog },
      }),
    "promotions.list": () => Response.json({ items: promotions }),
    "promotions.criteria": () => Response.json({ items: CRITERIA_BODY }),
    "groups.list": () =>
      Response.json({ items: [groupBody({ id: 7, title: "Writers" })] }),
  });
  const stream = await renderToReadableStream(
    withIntl(
      await PromotionList({
        searchParams: Promise.resolve({}),
        addAction: <a href="/admin/promotions/new">Add the page's action</a>,
      }),
    ),
  );
  await stream.allReady;
  return new Response(stream).text();
}

test("a promotion's row shows its rule and the groups it adds, and leads to its edit page", async () => {
  const html = await page([PROMOTION], true);
  expect(html).toContain('href="/admin/promotions/3"');
  expect(html).toContain(`${CRITERIA_BODY[0].title}: 50`);
  expect(html).toContain("Writers");
  expect(html).toContain("Active");
  // The sweep and the link to the history stay on the screen.
  expect(html).toContain("Run now");
  expect(html).toContain("Open the promotion history");
});

test("with no promotions the list offers the page's own add button", async () => {
  const html = await page([], false);
  expect(html).toContain("There are no promotions yet.");
  expect(html).toContain(
    '<a href="/admin/promotions/new">Add the page&#x27;s action</a>',
  );
  expect(html).not.toContain("Open the promotion history");
});
