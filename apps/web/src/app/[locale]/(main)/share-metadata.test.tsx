import { afterAll, afterEach, beforeEach, expect, mock, test } from "bun:test";
import { createTranslator } from "use-intl";
import { messagesFor } from "@/i18n/messages";
import { siteBody } from "@/lib/test-bodies";

// The share preview tags of the pages that describe one thing (a thread, a forum, a member), and
// none on a page that only some may open. The backend's answers are given as the pages read them.
const realFetch = globalThis.fetch;

mock.module("server-only", () => ({}));
const intl = { ...(await import("next-intl/server")) };
let locale: "en" | "es" = "en";
const catalogue = { en: await messagesFor("en"), es: await messagesFor("es") };
mock.module("next-intl/server", () => ({
  getLocale: async () => locale,
  getTranslations: async (namespace: string) =>
    createTranslator({
      locale,
      messages: catalogue[locale],
      namespace: namespace as never,
    }),
}));
const nextCache = { ...(await import("next/cache")) };
mock.module("next/cache", () => ({
  ...nextCache,
  cacheLife: () => {},
  cacheTag: () => {},
}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, toString: () => "" }),
}));

// What `read` answers, by operation; a page asking for anything else fails the test.
let answers: Record<string, (input: Record<string, unknown>) => unknown> = {};
const client = await import("@/lib/sermo/client");
// The mock rewrites the module's bindings in place: the real `read` is kept to put back.
const realClient = { ...client };
mock.module("@/lib/sermo/client", () => ({
  ...client,
  read: async (contract: { name: string }, input: Record<string, unknown>) => {
    const answer = answers[contract.name];
    if (!answer) throw new Error(`Unexpected read ${contract.name}`);
    return answer(input);
  },
}));

const thread = await import("./threads/[id]/page");
const forum = await import("./forums/[id]/page");
const member = await import("./members/[id]/page");
const account = await import("./account/page");
const accountLayout = await import("./account/layout");

afterAll(() => {
  mock.module("next-intl/server", () => intl);
  mock.module("next/cache", () => nextCache);
  mock.module("@/lib/sermo/client", () => realClient);
});
beforeEach(() => {
  locale = "en";
  answers = {};
  globalThis.fetch = (async (url: string) => {
    if (new URL(url).pathname === "/api/v1/site")
      return Response.json(siteBody({ description: "A club for gardeners." }));
    throw new Error(`Unexpected ${url}`);
  }) as unknown as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

type Robots = "index,follow" | "noindex,follow";
const seo = (canonical: string, robots: Robots, description = "") => ({
  title: "Built by the backend | Garden Club",
  description,
  canonical,
  robots,
  redirect: false,
  jsonLd: [],
});

const props = (id: string, query: Record<string, string> = {}) =>
  ({
    params: Promise.resolve({ locale, id }),
    searchParams: Promise.resolve(query),
  }) as never;

const SITE_FEED = {
  title: "Latest threads on Garden Club",
  url: "http://localhost:3000/feed.atom",
};

function threadAnswers(robots: Robots) {
  answers["threads.get"] = () => ({
    thread: {
      id: 12,
      title: "Pruning roses",
      createdAt: "2026-03-01T10:00:00.000Z",
      author: { id: 4, username: "wren" },
      lastPost: { postedAt: "2026-03-02T08:30:00.000Z" },
    },
    node: { id: 3, title: "Roses" },
    tags: ["pruning", "spring"],
    seo: seo(
      "http://localhost:3000/threads/12-pruning-roses",
      robots,
      "Cut above an outward bud.",
    ),
  });
  answers["seo.thread"] = ({ page }) =>
    seo(
      `http://localhost:3000/threads/12-pruning-roses?page=${page}`,
      robots,
      "Cut above an outward bud.",
    );
}

test("a thread is shared as an article by its author, in its forum, with its tags", async () => {
  threadAnswers("index,follow");
  const head = await thread.generateMetadata(props("12-pruning-roses"));
  expect(head.openGraph).toEqual({
    type: "article",
    title: "Pruning roses",
    description: "Cut above an outward bud.",
    url: "http://localhost:3000/threads/12-pruning-roses",
    siteName: "Garden Club",
    locale: "en_US",
    images: undefined,
    publishedTime: "2026-03-01T10:00:00.000Z",
    modifiedTime: "2026-03-02T08:30:00.000Z",
    authors: ["http://localhost:3000/members/4"],
    section: "Roses",
    tags: ["pruning", "spring"],
  });
  expect(head.twitter).toEqual({
    card: "summary",
    title: "Pruning roses",
    description: "Cut above an outward bud.",
    images: undefined,
  });
  expect(head.alternates).toEqual({
    canonical: "http://localhost:3000/threads/12-pruning-roses",
    types: { "application/atom+xml": [SITE_FEED] },
  });
  // The document's own title stays the backend's.
  expect(head.title).toEqual({
    absolute: "Built by the backend | Garden Club",
  });
});

test("every address of a shared page is on its canonical's origin, even when this app's public address differs", async () => {
  const origin = "https://garden.example";
  threadAnswers("index,follow");
  const found = answers["threads.get"]({}) as {
    seo: ReturnType<typeof seo>;
  };
  // The structured data names the author by their slugged address.
  answers["threads.get"] = () => ({
    ...found,
    seo: {
      ...seo(`${origin}/threads/12-pruning-roses`, "index,follow"),
      jsonLd: [
        {
          "@type": "DiscussionForumPosting",
          author: { "@type": "Person", url: `${origin}/members/4-wren` },
        },
      ],
    },
  });
  const head = await thread.generateMetadata(props("12-pruning-roses"));
  expect(head.openGraph?.url).toBe(`${origin}/threads/12-pruning-roses`);
  expect(
    head.openGraph && "authors" in head.openGraph && head.openGraph.authors,
  ).toEqual([`${origin}/members/4-wren`]);
  expect(head.alternates?.types).toEqual({
    "application/atom+xml": [{ ...SITE_FEED, url: `${origin}/feed.atom` }],
  });
  // With the text closed to the viewer there is no structured data: the plain address, same origin.
  answers["threads.get"] = () => ({
    ...found,
    seo: seo(`${origin}/threads/12-pruning-roses`, "index,follow"),
  });
  const closed = await thread.generateMetadata(props("12-pruning-roses"));
  expect(
    closed.openGraph &&
      "authors" in closed.openGraph &&
      closed.openGraph.authors,
  ).toEqual([`${origin}/members/4`]);
  answers["nodes.get"] = () => ({
    node: { id: 3, title: "Roses", type: "forum" },
    seo: seo(`${origin}/forums/3-roses`, "index,follow"),
  });
  const forumHead = await forum.generateMetadata(props("3-roses"));
  expect(forumHead.alternates?.types).toEqual({
    "application/atom+xml": [
      { ...SITE_FEED, url: `${origin}/feed.atom` },
      {
        title: "Latest threads in Roses",
        url: `${origin}/forums/3-roses/feed.atom`,
      },
    ],
  });
});

test("a later page of a thread is shared under its own address", async () => {
  threadAnswers("index,follow");
  const head = await thread.generateMetadata(
    props("12-pruning-roses", { page: "2" }),
  );
  expect(head.openGraph?.url).toBe(
    "http://localhost:3000/threads/12-pruning-roses?page=2",
  );
  expect(head.alternates?.canonical).toBe(head.openGraph?.url);
});

test("a thread guests may not open is not shared", async () => {
  threadAnswers("noindex,follow");
  const head = await thread.generateMetadata(props("12-pruning-roses"));
  expect(head.openGraph).toBeUndefined();
  expect(head.twitter).toBeUndefined();
  expect(head.alternates?.types).toBeUndefined();
});

function forumAnswers(robots: Robots, type = "forum") {
  answers["nodes.get"] = () => ({
    node: { id: 3, title: "Roses", type },
    seo: seo("http://localhost:3000/forums/3-roses", robots),
  });
}

test("a forum is shared as a page of the site, announcing its own feed after the site's", async () => {
  forumAnswers("index,follow");
  locale = "es";
  const head = await forum.generateMetadata(props("3-roses"));
  expect(head.openGraph).toEqual({
    type: "website",
    title: "Roses",
    // A forum with no description of its own is described by the site.
    description: "A club for gardeners.",
    url: "http://localhost:3000/forums/3-roses",
    siteName: "Garden Club",
    locale: "es_ES",
    images: undefined,
  });
  expect(head.alternates?.types).toEqual({
    "application/atom+xml": [
      {
        title: "Últimos temas en Garden Club",
        url: "http://localhost:3000/feed.atom",
      },
      {
        title: "Últimos temas en Roses",
        url: "http://localhost:3000/forums/3-roses/feed.atom",
      },
    ],
  });
});

test("a category has no feed of its own, and a forum closed to guests is not shared", async () => {
  forumAnswers("index,follow", "category");
  const category = await forum.generateMetadata(props("3-roses"));
  expect(category.alternates?.types).toEqual({
    "application/atom+xml": [SITE_FEED],
  });
  forumAnswers("noindex,follow");
  const closed = await forum.generateMetadata(props("3-roses"));
  expect(closed.openGraph).toBeUndefined();
  expect(closed.twitter).toBeUndefined();
  expect(closed.alternates?.types).toBeUndefined();
});

function memberAnswers(robots: Robots) {
  answers["profiles.get"] = () => ({
    id: 4,
    username: "wren",
    seo: seo(
      "http://localhost:3000/members/4-wren",
      robots,
      "Grows roses and beans.",
    ),
  });
}

test("a member's page is shared as their profile, on every tab under the one address", async () => {
  memberAnswers("index,follow");
  const head = await member.generateMetadata(props("4-wren"));
  expect(head.openGraph).toEqual({
    type: "profile",
    title: "wren",
    username: "wren",
    description: "Grows roses and beans.",
    url: "http://localhost:3000/members/4-wren",
    siteName: "Garden Club",
    locale: "en_US",
    images: undefined,
  });
  const tab = await member.generateMetadata(props("4-wren", { tab: "posts" }));
  expect(tab.robots).toEqual({ index: false, follow: true });
  expect(tab.openGraph?.url).toBe("http://localhost:3000/members/4-wren");
});

test("a profile guests may not see is not shared", async () => {
  memberAnswers("noindex,follow");
  const head = await member.generateMetadata(props("4-wren"));
  expect(head.openGraph).toBeUndefined();
  expect(head.twitter).toBeUndefined();
});

test("a member's own pages carry no share tags", async () => {
  const page = await account.generateMetadata();
  expect(page.openGraph).toBeUndefined();
  expect(page.twitter).toBeUndefined();
  expect(accountLayout.metadata.openGraph).toBeUndefined();
  expect(accountLayout.metadata.twitter).toBeUndefined();
});
