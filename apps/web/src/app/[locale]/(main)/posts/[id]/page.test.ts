import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { POSTS_PER_PAGE } from "@/lib/sermo/page-sizes";
import { postBody } from "@/lib/test-bodies";
import { viewerBody } from "@/lib/test-viewer";

const realFetch = globalThis.fetch;
let cookie = "";

mock.module("server-only", () => ({}));
const intl = await import("next-intl/server");
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async () => (key: string) => key,
}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(cookie ? { cookie } : {}),
  cookies: async () => ({ get: () => undefined, toString: () => cookie }),
}));

const { default: PostPage } = await import("./page");

afterAll(() => {
  mock.module("next-intl/server", () => intl);
});
afterEach(() => {
  globalThis.fetch = realFetch;
  cookie = "";
});

const STAFF = "sermo.session_token=staff";
const MEMBER = "sermo.session_token=member";

// The backend: the posts it shows each kind of visitor, by path; the paths in `closed` are forum
// posts closed to that visitor. Anything else is not found.
function backend(
  visible: Record<string, Record<string, unknown>>,
  closed: string[] = [],
) {
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    const { pathname } = new URL(url);
    const who = new Headers(init.headers).get("cookie") ?? "";
    if (pathname === "/api/v1/me") return Response.json(viewerBody(who !== ""));
    if (closed.includes(`${who}|${pathname}`)) {
      return Response.json(
        { error: { code: "forbidden", message: "Closed." } },
        { status: 403 },
      );
    }
    const shown = visible[`${who}|${pathname}`];
    if (shown) return Response.json(postBody(shown));
    return Response.json(
      { error: { code: "not_found", message: "Not found." } },
      { status: 404 },
    );
  }) as unknown as typeof fetch;
}

async function open(id: string) {
  try {
    await PostPage({
      params: Promise.resolve({ locale: "en", id }),
    } as unknown as Parameters<typeof PostPage>[0]);
  } catch (error) {
    return (error as { digest?: string }).digest;
  }
  throw new Error("the page answered with a page");
}

const redirectTo = (path: string) => `NEXT_REDIRECT;replace;${path};307;`;
const NOT_FOUND = "NEXT_HTTP_ERROR_FALLBACK;404";

test("a post on the first page goes to its thread with its anchor and no page", async () => {
  backend({
    "|/api/v1/posts/31": { id: 31, threadId: 7, position: POSTS_PER_PAGE - 1 },
  });
  expect(await open("31")).toBe(redirectTo("/threads/7#post-31"));
});

test("a post on the third page names that page", async () => {
  backend({
    "|/api/v1/posts/90": {
      id: 90,
      threadId: 7,
      position: POSTS_PER_PAGE * 2 + 5,
    },
  });
  expect(await open("90")).toBe(redirectTo("/threads/7?page=3#post-90"));
});

test("a deleted post goes to its thread for staff and is a 404 for a member", async () => {
  backend({
    [`${STAFF}|/api/v1/posts/44`]: {
      id: 44,
      threadId: 9,
      position: 3,
      state: "deleted",
    },
  });
  cookie = STAFF;
  expect(await open("44")).toBe(redirectTo("/threads/9#post-44"));
  cookie = MEMBER;
  expect(await open("44")).toBe(NOT_FOUND);
});

test("a post of a forum the visitor cannot see is a 404, the same as a missing one", async () => {
  backend({
    [`${STAFF}|/api/v1/posts/50`]: { id: 50, threadId: 12, position: 0 },
  });
  const guest = await open("50");
  expect(guest).toBe(NOT_FOUND);
  expect(await open("51")).toBe(guest);
  cookie = STAFF;
  expect(await open("50")).toBe(redirectTo("/threads/12#post-50"));
});

test("an id that is not a plain number is a 404 and the backend is not asked", async () => {
  const asked: string[] = [];
  globalThis.fetch = (async (url: string) => {
    asked.push(url);
    return Response.json({});
  }) as unknown as typeof fetch;
  for (const id of ["0", "x", "07", "1e2", "5-news"])
    expect(await open(id)).toBe(NOT_FOUND);
  expect(asked).toEqual([]);
});

test("a post in a forum whose posts are closed to the visitor is a 404, as a missing one is", async () => {
  backend({}, ["|/api/v1/posts/60", `${MEMBER}|/api/v1/posts/60`]);
  const missing = await open("61");
  expect(missing).toBe(NOT_FOUND);
  expect(await open("60")).toBe(missing);
  cookie = MEMBER;
  expect(await open("60")).toBe(missing);
});

test("a post refused as +18 reaches the error screen as the +18 refusal, which draws the +18 page", async () => {
  globalThis.fetch = (async (url: string) => {
    const { pathname } = new URL(url);
    if (pathname === "/api/v1/me") return Response.json(viewerBody(false));
    return Response.json(
      {
        error: {
          code: "forbidden",
          message: "For adults.",
          issues: [{ path: ["adult"], message: "guest" }],
        },
      },
      { status: 403 },
    );
  }) as unknown as typeof fetch;
  expect(await open("70")).toBe("sermo.adult.guest");
});
