import { afterAll, afterEach, beforeEach, expect, mock, test } from "bun:test";
import { translator } from "@/lib/test-intl";
import { viewerBody } from "@/lib/test-viewer";

const realFetch = globalThis.fetch;

mock.module("server-only", () => ({}));
const intl = await import("next-intl/server");
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async (namespace: string) => translator(namespace),
}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, toString: () => "" }),
}));

const { viewerOfRequest } = await import("@/lib/sermo/client");
const { moreResults } = await import("./more-results");
const { restorePages } = await import("@/lib/list-pages");

afterAll(() => {
  mock.module("next-intl/server", () => intl);
});
beforeEach(() => {
  mock.module("@/lib/sermo/session", () => ({ getViewer: viewerOfRequest }));
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const filters = { query: "garden", titlesOnly: false, author: "" };

// The backend answers the search with what the test says; the visitor is signed in.
function backend(search: Response) {
  globalThis.fetch = (async (url: string) => {
    const { pathname } = new URL(url);
    if (pathname === "/api/v1/me") return Response.json(viewerBody(true));
    if (pathname === "/api/v1/search") return search.clone();
    return Response.json(
      { error: { code: "not_found", message: "?" } },
      { status: 404 },
    );
  }) as unknown as typeof fetch;
}

const refusal = (status: number, code: string) =>
  Response.json({ error: { code, message: code } }, { status });

const first = { rows: [{ key: "a", node: null }], nextCursor: "c1" };
const more = (cursor: string | null) => moreResults(filters, undefined, cursor);

test("an address that asks for more search pages keeps page one when the backend rate-limits the next", async () => {
  backend(refusal(429, "rate_limited"));
  const pages = await restorePages(first, more, 3);
  expect(pages).toHaveLength(1);
});

test("a failure of the backend on a later page keeps the pages that were read", async () => {
  backend(refusal(500, "internal"));
  expect(await restorePages(first, more, 3)).toHaveLength(1);
});

test("a rate limit on a page the visitor scrolled to is raised, so the list offers to try again", async () => {
  backend(refusal(429, "rate_limited"));
  let raised: { code?: string; status?: number } | undefined;
  await more("c1").catch((error) => {
    raised = error;
  });
  expect(raised?.code).toBe("rate_limited");
  expect(raised?.status).toBe(429);
});

test("a cursor the backend refuses ends the list with an empty page", async () => {
  backend(refusal(400, "validation"));
  const ended = await more("stale");
  expect(ended.rows).toHaveLength(0);
  expect(ended.nextCursor).toBeNull();
});
