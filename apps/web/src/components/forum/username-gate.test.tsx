import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { siteBody } from "@/lib/test-bodies";
import { viewerBody } from "@/lib/test-viewer";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

let sent = new Headers();
mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  headers: async () => sent,
  cookies: async () => ({ get: () => undefined, toString: () => "" }),
}));
const nextCache = await import("next/cache");
mock.module("next/cache", () => ({
  ...nextCache,
  cacheLife: () => {},
  cacheTag: () => {},
}));

const { requireOwnUsername } = await import("./username-gate");
const { AcceptanceGate } = await import("./acceptance-gate");

afterAll(() => {
  mock.module("next/cache", () => nextCache);
});

// auth.me answers a member who needs a username, or not; returns the paths asked.
function backend(needsUsername: boolean) {
  const asked: string[] = [];
  globalThis.fetch = (async (input: string) => {
    const path = new URL(input).pathname;
    asked.push(path);
    if (path === "/api/v1/site") return Response.json(siteBody());
    const viewer = viewerBody(true);
    return Response.json({
      ...viewer,
      user: { ...viewer.user, needsUsername },
    });
  }) as unknown as typeof fetch;
  return asked;
}

async function redirectOf(run: () => Promise<unknown>) {
  try {
    await run();
    return null;
  } catch (error) {
    const digest = String((error as { digest?: unknown }).digest);
    if (!digest.startsWith("NEXT_REDIRECT")) throw error;
    return digest.split(";")[2];
  }
}

test("a member who still needs a username is sent to choose one, with the page to come back to", async () => {
  sent = new Headers({ "x-sermo-path": "/threads/7?page=2" });
  expect(
    await redirectOf(() => requireOwnUsername({ needsUsername: true })),
  ).toBe("/choose-username?next=%2Fthreads%2F7%3Fpage%3D2");
});

test("a path that is no page to return to is left out", async () => {
  sent = new Headers({ "x-sermo-path": "//evil.example" });
  expect(
    await redirectOf(() => requireOwnUsername({ needsUsername: true })),
  ).toBe("/choose-username");
});

test("the site's policy pages open for a member who still needs a username: the screen links to them", async () => {
  for (const path of [
    "/terms",
    "/rules",
    "/privacy",
    "/cookies",
    "/legal",
    "/contact",
    "/terms?x=1",
    "/privacy#data",
  ]) {
    sent = new Headers({ "x-sermo-path": path });
    expect(
      await redirectOf(() => requireOwnUsername({ needsUsername: true })),
      path,
    ).toBeNull();
  }
  for (const path of ["/terms-of-x", "/members/2", "/"]) {
    sent = new Headers({ "x-sermo-path": path });
    expect(
      await redirectOf(() => requireOwnUsername({ needsUsername: true })),
      path,
    ).not.toBeNull();
  }
});

test("a member with a username of their own, a guest, and a backend without the field go on", async () => {
  sent = new Headers({ "x-sermo-path": "/threads/7" });
  for (const member of [{ needsUsername: false }, null, {}])
    expect(await redirectOf(() => requireOwnUsername(member))).toBeNull();
});

test("the forum's gate before every page asks first, so the page is never drawn", async () => {
  sent = new Headers({
    cookie: "sermo.session_token=abc",
    "x-sermo-path": "/members/2",
  });
  const asked = backend(true);
  expect(await redirectOf(() => AcceptanceGate({ children: "the page" }))).toBe(
    "/choose-username?next=%2Fmembers%2F2",
  );
  // Only who they are was asked: nothing of the page.
  expect(asked).toEqual(["/api/v1/me"]);
  backend(false);
  expect(await AcceptanceGate({ children: "the page" })).toBe("the page");
});
