import { afterAll, afterEach, beforeEach, expect, mock, test } from "bun:test";
import { renderToReadableStream } from "react-dom/server";
import { fakeBackend } from "@/app/[locale]/(staff)/admin/groups/test-backend";
import { translator, withIntl } from "@/lib/test-intl";
import { viewerBody } from "@/lib/test-viewer";

mock.module("server-only", () => ({}));
const intl = await import("next-intl/server");
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async (namespace: string) => translator(namespace),
}));
const navigation = await import("next/navigation");
// The alert rows go through the router; the page's own redirect stays the real one.
mock.module("next/navigation", () => ({
  ...navigation,
  useRouter: () => ({ refresh: () => {} }),
}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, toString: () => "" }),
}));

const { viewerOfRequest } = await import("@/lib/sermo/client");
const { default: NotificationsPage } = await import("./page");
const { notificationsPageAction } = await import("./notifications-page-action");

afterAll(() => {
  mock.module("next/navigation", () => navigation);
  mock.module("next-intl/server", () => intl);
});
beforeEach(() => {
  mock.module("@/lib/sermo/session", () => ({ getViewer: viewerOfRequest }));
});
let backend: ReturnType<typeof fakeBackend> | undefined;
afterEach(() => backend?.restore());

const when = "2026-01-01T00:00:00.000Z";
const alert = (id: number, name: string) => ({
  id,
  type: "member.followed",
  contentType: "user",
  contentId: 9,
  threadId: null,
  actors: [{ id: 9, username: name }],
  actorCount: 1,
  contentTitle: null,
  url: "/members/9",
  data: {},
  createdAt: when,
  updatedAt: when,
  read: false,
});

// Alerts for 45 in all (three pages of 20), the ones given on the page asked for.
function alerts(items = [alert(8, "OnPageTwo")]) {
  backend = fakeBackend({
    "auth.me": () => Response.json(viewerBody(true)),
    "site.get": () => Response.json({}),
    "notifications.list": () =>
      Response.json({ items, nextCursor: null, unreadCount: 3, total: 45 }),
    "reactionTypes.list": () => Response.json({ items: [], nextCursor: null }),
    "users.cards": () => Response.json({ items: [] }),
  });
}

async function draw(query: Record<string, string>) {
  const errors: unknown[] = [];
  const stream = await renderToReadableStream(
    withIntl(
      await NotificationsPage({
        params: Promise.resolve({ locale: "en" }),
        searchParams: Promise.resolve(query),
      } as never),
    ),
    { onError: (error) => void errors.push(error) },
  );
  await stream.allReady;
  return { html: await new Response(stream).text(), errors };
}

test("the alerts are numbered pages, plain links that work without scripts", async () => {
  alerts();
  const { html, errors } = await draw({ page: "2" });
  expect(errors).toEqual([]);
  expect(html).toContain("OnPageTwo");
  expect(html).toContain('aria-current="page"');
  expect(html).toContain('href="/notifications?page=3"');
  expect(html).toContain('href="/notifications"');
  expect(html).not.toContain("cursor=");
  expect(
    backend?.asked.find((call) => call.operation === "notifications.list"),
  ).toBeDefined();
});

test("a page past the last one goes to the last one, as XenForo does", async () => {
  alerts([]);
  const error = await draw({ page: "9" }).catch((thrown) => thrown);
  expect(String((error as { digest?: string }).digest)).toContain(
    ";/notifications?page=3;",
  );
});

test("the in-place switch gets the page drawn, and nothing for a page with no alerts", async () => {
  alerts();
  const drawn = await notificationsPageAction(2);
  const stream = await renderToReadableStream(withIntl(drawn));
  await stream.allReady;
  const html = await new Response(stream).text();
  expect(html).toContain("OnPageTwo");
  expect(html).toContain('href="/notifications?page=3"');
  alerts([]);
  expect(await notificationsPageAction(5)).toBeNull();
});
