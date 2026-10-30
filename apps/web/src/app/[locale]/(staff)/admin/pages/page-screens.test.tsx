import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { PageSlug } from "@sermo/core/contracts";
import { renderToReadableStream } from "react-dom/server";
import { translator, withIntl } from "@/lib/test-intl";
import { viewerBody } from "@/lib/test-viewer";

const realFetch = globalThis.fetch;
const intl = await import("next-intl/server");
// The rows read their words through the library's hook and the provider of `withIntl`, whatever
// stand-in another suite left in place for it.
const nextIntl = await import("next-intl");
const useIntl = await import("use-intl");
mock.module("next-intl", () => ({
  ...nextIntl,
  useLocale: () => "en",
  useTranslations: useIntl.useTranslations,
}));
mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, toString: () => "" }),
}));
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getFormatter: async () => ({
    dateTime: (date: Date) => date.toISOString().slice(0, 10),
  }),
  getTranslations: async (namespace: string) => translator(namespace, true),
}));

const { PageList } = await import("./page-list");
const PageEditPage = (await import("./[slug]/page")).default;
const NewPagePage = (await import("./-new/page")).default;

afterEach(() => {
  globalThis.fetch = realFetch;
});
afterAll(() => {
  mock.module("next-intl/server", () => intl);
  mock.module("next-intl", () => nextIntl);
});

const PAGES = [
  {
    slug: "terms",
    title: "Terms of use",
    isPublished: true,
    version: 1,
    updatedAt: "2026-03-01T10:00:00.000Z",
  },
  {
    slug: "about-us",
    title: "About us",
    isPublished: false,
    version: 1,
    updatedAt: "2026-04-02T10:00:00.000Z",
  },
];

function backend() {
  globalThis.fetch = (async (input: string) => {
    const { pathname } = new URL(input);
    if (pathname === "/api/v1/me") return Response.json(viewerBody(true));
    if (pathname === "/api/v1/pages") return Response.json({ items: PAGES });
    throw new Error(`Unexpected ${pathname}`);
  }) as unknown as typeof fetch;
}

async function draw(element: React.ReactNode) {
  const failures: unknown[] = [];
  const stream = await renderToReadableStream(withIntl(element), {
    onError: (error) => {
      failures.push(error);
    },
  });
  await stream.allReady;
  const html = (await new Response(stream).text()).replaceAll("&#x27;", "'");
  return { html, failures };
}

const list = () =>
  draw(
    <PageList
      searchParams={Promise.resolve({})}
      addAction={<a href="/admin/pages/-new">New page</a>}
    />,
  );

test("each page is a row leading to its edit page, with its state, address and date", async () => {
  backend();
  const { html } = await list();
  expect(html).toContain('href="/admin/pages/terms"');
  expect(html).toContain('href="/admin/pages/about-us"');
  expect(html).toContain("Published");
  expect(html).toContain("Not published");
  expect(html).toMatch(
    /Slug terms · Address \/terms · Saved <time dateTime="2026-03-01[^>]*>Mar 1<\/time>/,
  );
  expect(html).toContain("Slug about-us · Address /pages/about-us");
});

test("the well-known pages that do not exist yet lead to the new page with their slug", async () => {
  backend();
  const { html } = await list();
  expect(html).toContain("Create the page privacy");
  expect(html).toMatch(/href="\/admin\/pages\/-new\?slug=privacy"/);
  // `terms` exists, so it is not offered again.
  expect(html).not.toContain("Create the page terms");
});

test("the old address that carried a suggested slug leads to the new page without reading the pages", async () => {
  globalThis.fetch = (async () => {
    throw new Error("the pages were read");
  }) as unknown as typeof fetch;
  const redirected = await PageList({
    searchParams: Promise.resolve({ slug: "privacy" }),
    addAction: null,
  }).catch((error: { digest?: string }) => error.digest);
  expect(redirected).toContain("/admin/pages/-new?slug=privacy");
});

test("the new page asks for the slug, prefilled when a suggestion sent it, and the page's fields", async () => {
  backend();
  const { html } = await draw(
    <NewPagePage
      params={Promise.resolve({ locale: "en" })}
      searchParams={Promise.resolve({ slug: "legal" })}
    />,
  );
  expect(html).toMatch(/<input[^>]*name="slug"[^>]*value="legal"/);
  for (const name of ["title", "body", "isPublished"]) {
    expect(html).toContain(`name="${name}"`);
  }
  // A new page has no version to raise.
  expect(html).not.toContain('name="newVersion"');
});

test("no slug can be the new page's address, and a page called new has its editor at /admin/pages/new", async () => {
  expect(PageSlug.safeParse("-new").success).toBe(false);
  expect(PageSlug.safeParse("new").success).toBe(true);
  globalThis.fetch = (async (input: string) => {
    const { pathname } = new URL(input);
    if (pathname === "/api/v1/me") return Response.json(viewerBody(true));
    if (pathname === "/api/v1/pages/new/source") {
      return Response.json({
        slug: "new",
        title: "What is new",
        bodyHtml: "<p>News</p>",
        bodySource: "News",
        isPublished: true,
        version: 1,
        updatedAt: "2026-03-01T10:00:00.000Z",
      });
    }
    throw new Error(`Unexpected ${pathname}`);
  }) as unknown as typeof fetch;
  const { html } = await draw(
    <PageEditPage
      params={Promise.resolve({ locale: "en", slug: "new" })}
      searchParams={Promise.resolve({})}
    />,
  );
  expect(html).toMatch(/<input[^>]*name="slug"[^>]*value="new"/);
  expect(html).toContain("What is new");
  expect(html).toContain("Delete page");
});
