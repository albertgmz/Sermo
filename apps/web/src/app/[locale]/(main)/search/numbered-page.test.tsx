import { afterAll, afterEach, beforeEach, expect, mock, test } from "bun:test";
import { renderToReadableStream } from "react-dom/server";
import {
  fakeBackend,
  refusal,
} from "@/app/[locale]/(staff)/admin/groups/test-backend";
import { translator, withIntl } from "@/lib/test-intl";
import { viewerBody } from "@/lib/test-viewer";

mock.module("server-only", () => ({}));
const intl = await import("next-intl/server");
const { createTranslator } = await import("use-intl");
const { messages } = await import("@/i18n/messages");
// The `details` line takes tags (t.rich): the real translator fills them.
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async (namespace: string) =>
    namespace === "search.search"
      ? createTranslator({ locale: "en", messages, namespace } as never)
      : translator(namespace),
}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, toString: () => "" }),
}));
const nextIntl = { ...(await import("next-intl")) };
const { useTranslations, useFormatter } = await import("use-intl");
mock.module("next-intl", () => ({
  ...nextIntl,
  useLocale: () => "en",
  useTranslations,
  useFormatter,
}));

const { viewerOfRequest } = await import("@/lib/sermo/client");
const { Results } = await import("./results");
const { searchPageAction } = await import("./search-page-action");

afterAll(() => {
  mock.module("next-intl/server", () => intl);
  mock.module("next-intl", () => nextIntl);
});
beforeEach(() => {
  mock.module("@/lib/sermo/session", () => ({ getViewer: viewerOfRequest }));
});
let backend: ReturnType<typeof fakeBackend> | undefined;
afterEach(() => backend?.restore());

const when = "2026-01-01T00:00:00.000Z";
const filters = { query: "garden", titlesOnly: true, author: "" };
const result = (threadId: number, title: string) => ({
  post: {
    id: threadId * 10,
    position: 0,
    createdAt: when,
    author: { kind: "member", id: 4, username: "ana" },
    excerpt: "garden hose",
  },
  thread: {
    id: threadId,
    title,
    nodeId: 2,
    node: { id: 2, title: "General" },
    prefix: null,
  },
});

// A search with 45 results (three pages of 20), the ones given on the page asked for.
function found(items: unknown[], search?: () => Response) {
  backend = fakeBackend({
    "auth.me": () => Response.json(viewerBody(true)),
    "search.query":
      search ?? (() => Response.json({ items, nextCursor: null, total: 45 })),
    "users.cards": () => Response.json({ items: [] }),
  });
}

async function html(element: unknown) {
  const stream = await renderToReadableStream(withIntl(element as never));
  await stream.allReady;
  return new Response(stream).text();
}

test("the results are numbered pages whose links keep the query and the filters", async () => {
  found([result(8, "On page two")]);
  const page = await html(await Results({ filters, page: 2 }));
  expect(page).toContain("On page two");
  expect(page).toContain('aria-current="page"');
  // Plain links, with the filters kept: they work without scripts.
  expect(page).toContain('href="/search?q=garden&amp;titles=1&amp;page=3"');
  expect(page).toContain('href="/search?q=garden&amp;titles=1"');
  expect(page).not.toContain("cursor=");
});

test("a page past the last one goes to the last one, as XenForo does", async () => {
  found([]);
  const error = await Results({ filters, page: 9 }).catch(
    (thrown: unknown) => thrown,
  );
  expect(String((error as { digest?: string }).digest)).toContain(
    ";/search?q=garden&titles=1&page=3;",
  );
});

test("the in-place switch gets the page drawn, null for an empty page or a refusal", async () => {
  found([result(8, "On page two")]);
  const drawn = await html(await searchPageAction(filters, undefined, 2));
  expect(drawn).toContain("On page two");
  expect(drawn).toContain('href="/search?q=garden&amp;titles=1&amp;page=3"');
  found([]);
  expect(await searchPageAction(filters, undefined, 5)).toBeNull();
  // A rate limit: the browser opens the address, whose page says so.
  found([], () => refusal(429, "rate_limited"));
  expect(await searchPageAction(filters, undefined, 2)).toBeNull();
});
