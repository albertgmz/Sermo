import { afterAll, afterEach, beforeEach, expect, mock, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToReadableStream } from "react-dom/server";
import {
  fakeBackend,
  refusal,
} from "@/app/[locale]/(staff)/admin/groups/test-backend";
import { messages } from "@/i18n/messages";
import { siteBody } from "@/lib/test-bodies";
import { translator, withIntl } from "@/lib/test-intl";
import { viewerBody } from "@/lib/test-viewer";

mock.module("server-only", () => ({}));
const nextCache = await import("next/cache");
mock.module("next/cache", () => ({
  ...nextCache,
  cacheLife: () => {},
  cacheTag: () => {},
}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, toString: () => "" }),
}));
const intlServer = await import("next-intl/server");
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async (namespace: string) => translator(namespace, true),
}));
const navigation = await import("next/navigation");
mock.module("next/navigation", () => ({
  ...navigation,
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({
    push() {},
    replace() {},
    refresh() {},
    back() {},
    prefetch() {},
  }),
}));
const intl = { ...(await import("next-intl")) };
const { useTranslations, useFormatter, useNow } = await import("use-intl");
mock.module("next-intl", () => ({
  ...intl,
  useLocale: () => "en",
  useTranslations,
  useFormatter,
  useNow,
}));

const { viewerOfRequest } = await import("@/lib/sermo/client");
const { default: TagPage, generateMetadata } = await import("./page");

afterAll(() => {
  mock.module("next/cache", () => nextCache);
  mock.module("next-intl/server", () => intlServer);
  mock.module("next/navigation", () => navigation);
  mock.module("next-intl", () => intl);
});
// Another test file leaves a stand-in for the viewer in place: the page asks the backend.
beforeEach(() => {
  mock.module("@/lib/sermo/session", () => ({ getViewer: viewerOfRequest }));
});
let backend: ReturnType<typeof fakeBackend> | undefined;
afterEach(() => backend?.restore());

const when = "2026-01-01T00:00:00.000Z";
const thread = (id: number, title: string) => ({
  id,
  nodeId: 2,
  node: { id: 2, title: "General" },
  title,
  prefix: null,
  excerpt: "how it started",
  cover: null,
  highlightedUntil: null,
  bumpedAt: null,
  author: { id: 4, username: "member4" },
  state: "visible",
  isSticky: false,
  isLocked: false,
  createdAt: when,
  replyCount: 4,
  viewCount: 10,
  firstPostId: 30,
  lastPost: {
    postId: 31,
    position: 4,
    postedAt: when,
    user: { id: 3, username: "member3" },
  },
  readPosition: null,
  isUnread: false,
  pollKind: null,
});
const seo = (robots = "index,follow") => ({
  title: "#café | Forum",
  description: "Threads tagged #café on Forum.",
  canonical: "http://localhost:3000/tags/caf%C3%A9",
  robots,
  redirect: false,
  jsonLd: [],
});

async function page(name = "caf%C3%A9", query: Record<string, string> = {}) {
  const errors: unknown[] = [];
  const node = await TagPage({
    params: Promise.resolve({ locale: "en", name }),
    searchParams: Promise.resolve(query),
  } as unknown as Parameters<typeof TagPage>[0]);
  const stream = await renderToReadableStream(
    withIntl(
      <QueryClientProvider client={new QueryClient()}>
        {node}
      </QueryClientProvider>,
    ),
    {
      onError: (error) => {
        errors.push(error);
      },
    },
  );
  await stream.allReady;
  return { html: await new Response(stream).text(), errors };
}

const found = (items: unknown[], nextCursor: string | null = null) => ({
  "auth.me": () => Response.json(viewerBody(false)),
  "tags.get": () =>
    Response.json({ name: "café", redirect: false, seo: seo() }),
  "tags.threads": () => Response.json({ items, nextCursor }),
  "users.cards": () => Response.json({ items: [] }),
  "site.get": () => Response.json(siteBody()),
});

test("the page names the tag and lists its threads as a forum does, asking by the decoded name", async () => {
  backend = fakeBackend(
    found([thread(8, "Coffee on a budget"), thread(7, "Roasting at home")]),
  );
  const { html, errors } = await page();
  expect(errors).toEqual([]);
  expect(html).toContain("#café");
  expect(html).toContain("Coffee on a budget");
  expect(html).toContain("Roasting at home");
  expect(html).toContain('href="/threads/8"');
  // The threads come from several forums, so each names its own.
  expect(html).toContain('href="/forums/2"');
  expect(html.indexOf("Coffee on a budget")).toBeLessThan(
    html.indexOf("Roasting at home"),
  );
  const asked = backend.asked.filter((call) => call.operation === "tags.get");
  expect(asked[0]?.path).toBe("/api/v1/tags/caf%C3%A9");
});

test("a tag the backend does not have is the 404 page, not an error screen", async () => {
  backend = fakeBackend({
    "auth.me": () => Response.json(viewerBody(false)),
    "tags.get": () => refusal(404, "not_found", "No such tag."),
  });
  const error = await page("nothing").catch((thrown) => thrown);
  expect(String(error.digest)).toContain("404");
});

test("an old name goes to the tag's current one", async () => {
  backend = fakeBackend({
    "auth.me": () => Response.json(viewerBody(false)),
    "tags.get": () =>
      Response.json({ name: "color", redirect: true, seo: seo() }),
  });
  const error = await page("colour").catch((thrown) => thrown);
  expect(String(error.digest)).toContain("/tags/color");
});

test("a refused list does not take the page down: the heading is there and the list is not", async () => {
  backend = fakeBackend({
    ...found([]),
    "tags.threads": () => refusal(403, "forbidden", "Not for you."),
  });
  const { html } = await page();
  expect(html).toContain("#café");
  expect(html).not.toContain("Coffee");
});

test("a page past the last one says there is nothing, not an error", async () => {
  backend = fakeBackend(found([]));
  const { html, errors } = await page("caf%C3%A9", { cursor: "abc" });
  expect(errors).toEqual([]);
  expect(html).toContain(messages.forums.tagPage.noMoreTitle);
});

test("an empty page that says where to go on is still the list, with its button", async () => {
  backend = fakeBackend(found([], "next-key"));
  const { html, errors } = await page();
  expect(errors).toEqual([]);
  expect(html).toContain(messages.forums.tagPage.nextPage);
  expect(html).not.toContain(messages.forums.tagPage.emptyTitle);
});

test("a link into the list that lands past its end says so and leads back to the start", async () => {
  backend = fakeBackend(found([]));
  const { html } = await page("caf%C3%A9", { cursor: "abc" });
  expect(html).toContain(messages.forums.tagPage.noMoreTitle);
  expect(html).toContain(messages.forums.tagPage.backToStart);
  expect(html).toContain('href="/tags/caf%C3%A9"');
  expect(html).not.toContain(messages.forums.tagPage.emptyTitle);
});

test("the head comes from the backend, with a description in the visitor's language", async () => {
  backend = fakeBackend(found([thread(8, "Coffee")]));
  const meta = await generateMetadata({
    params: Promise.resolve({ locale: "en", name: "caf%C3%A9" }),
    searchParams: Promise.resolve({}),
  } as unknown as Parameters<typeof generateMetadata>[0]);
  expect(meta.title).toEqual({ absolute: "#café | Forum" });
  expect(meta.description).toBe("Threads tagged #café");
  expect(meta.alternates?.canonical).toBe(
    "http://localhost:3000/tags/caf%C3%A9",
  );
  expect(meta.robots).toEqual({ index: true, follow: true });
  expect(meta.openGraph?.title).toBe("#café");
  expect(meta.openGraph?.url).toBe("http://localhost:3000/tags/caf%C3%A9");
  // A list continued by cursor is a copy of the page.
  const copy = await generateMetadata({
    params: Promise.resolve({ locale: "en", name: "caf%C3%A9" }),
    searchParams: Promise.resolve({ cursor: "abc" }),
  } as unknown as Parameters<typeof generateMetadata>[0]);
  expect(copy.robots).toEqual({ index: false, follow: true });
});
