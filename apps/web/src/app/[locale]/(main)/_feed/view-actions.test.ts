import { afterEach, expect, mock, test } from "bun:test";
import { viewerBody } from "@/lib/test-viewer";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  cookieSets.length = 0;
});

const cookieSets: unknown[][] = [];
mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({
    get: () => undefined,
    set: (...args: unknown[]) => cookieSets.push(args),
    delete: () => {},
    toString: () => "",
  }),
}));
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async () => (key: string) => key,
}));

const source = "./view-actions.ts?feed-view";
const { setFeedView } = (await import(
  source
)) as typeof import("./view-actions");

const PREFERENCES = {
  watchOnCreate: "watch",
  watchOnReply: "watch",
  language: null,
  profileViewPrivacy: "everyone",
  profilePostPrivacy: "members",
  keyboardShortcuts: true,
  homeTab: null,
  feedView: "compact",
  theme: null,
  showOnline: true,
};

// The backend: auth.me for the visitor and an answer for the preferences write.
function backend(
  signedIn: boolean,
  answer: Response = Response.json(PREFERENCES),
  resolved: Record<string, boolean> = {},
) {
  const asked: { method: string; path: string; body: unknown }[] = [];
  globalThis.fetch = (async (input: string, init: RequestInit) => {
    const path = new URL(input).pathname;
    asked.push({
      method: init.method ?? "GET",
      path,
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    });
    return path.endsWith("/me")
      ? Response.json({
          ...viewerBody(signedIn),
          resolvedPermissions: resolved,
        })
      : answer.clone();
  }) as unknown as typeof fetch;
  return asked;
}

test("a member's choice is written to their account, and no cookie is set", async () => {
  const asked = backend(true);
  expect(await setFeedView("compact")).toEqual({ ok: true });
  expect(asked.at(-1)).toMatchObject({
    method: "PATCH",
    path: "/api/v1/me/preferences",
    body: { feedView: "compact" },
  });
  expect(cookieSets).toEqual([]);
});

test("a guest's choice is a cookie the server reads, and no write is made", async () => {
  const asked = backend(false);
  expect(await setFeedView("compact")).toEqual({ ok: true });
  expect(asked.some((call) => call.path.includes("preferences"))).toBe(false);
  expect(cookieSets).toHaveLength(1);
  expect(cookieSets[0]?.slice(0, 2)).toEqual(["forum_feed_view", "compact"]);
  expect(cookieSets[0]?.[2]).toMatchObject({ httpOnly: true, path: "/" });
});

test("a member whose group may not edit their profile keeps the choice in the cookie, without asking the backend", async () => {
  const asked = backend(true, undefined, { "profile.editOwn": false });
  expect(await setFeedView("compact")).toEqual({ ok: true });
  expect(asked.some((call) => call.path.includes("preferences"))).toBe(false);
  expect(cookieSets[0]?.slice(0, 2)).toEqual(["forum_feed_view", "compact"]);
});

test("a member the backend refuses with forbidden also keeps it in the cookie", async () => {
  backend(
    true,
    Response.json(
      { error: { code: "forbidden", message: "Not allowed." } },
      { status: 403 },
    ),
  );
  expect(await setFeedView("compact")).toEqual({ ok: true });
  expect(cookieSets).toHaveLength(1);
  expect(cookieSets[0]?.slice(0, 2)).toEqual(["forum_feed_view", "compact"]);
});

test("a session that ended says where to sign in and sets no cookie", async () => {
  backend(
    true,
    Response.json(
      { error: { code: "unauthenticated", message: "Sign in." } },
      { status: 401 },
    ),
  );
  expect(await setFeedView("compact")).toEqual({
    ok: false,
    error: "Sign in.",
    signIn: "/login?next=%2F",
  });
  expect(cookieSets).toEqual([]);
});

test("a refusal comes back as the backend's message, and the account keeps what it had", async () => {
  backend(
    true,
    Response.json(
      { error: { code: "conflict", message: "Try again." } },
      { status: 409 },
    ),
  );
  expect(await setFeedView("compact")).toEqual({
    ok: false,
    error: "Try again.",
  });
  expect(cookieSets).toEqual([]);
});

test("a layout that is not one is refused before anything is sent", async () => {
  const asked = backend(true);
  const answer = await setFeedView("grid");
  expect(answer.ok).toBe(false);
  expect(asked).toEqual([]);
  expect(cookieSets).toEqual([]);
});

test("the guest's layout cookie is HttpOnly, Lax, and Secure on an https site", async () => {
  const before = process.env.SERMO_PUBLIC_URL;
  try {
    for (const [url, secure] of [
      ["https://forum.example.test", true],
      ["http://localhost:3000", false],
    ] as const) {
      process.env.SERMO_PUBLIC_URL = url;
      cookieSets.length = 0;
      backend(false);
      await setFeedView("compact");
      expect(cookieSets[0]?.[2], url).toMatchObject({
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure,
      });
    }
  } finally {
    if (before === undefined) delete process.env.SERMO_PUBLIC_URL;
    else process.env.SERMO_PUBLIC_URL = before;
  }
});
