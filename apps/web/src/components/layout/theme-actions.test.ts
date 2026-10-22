import { afterEach, expect, mock, test } from "bun:test";
import { viewerBody } from "@/lib/test-viewer";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  cookieSets.length = 0;
  cookieDeletes.length = 0;
});

const cookieSets: unknown[][] = [];
const cookieDeletes: unknown[] = [];
mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({
    get: () => undefined,
    set: (...args: unknown[]) => cookieSets.push(args),
    delete: (name: unknown) => cookieDeletes.push(name),
    toString: () => "",
  }),
}));
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async () => (key: string) => key,
}));

const source = "./theme-actions.ts?theme";
const { saveTheme } = (await import(
  source
)) as typeof import("./theme-actions");

const PREFERENCES = {
  watchOnCreate: "watch",
  watchOnReply: "watch",
  language: null,
  profileViewPrivacy: "everyone",
  profilePostPrivacy: "members",
  keyboardShortcuts: true,
  homeTab: null,
  feedView: "cards",
  theme: "dark",
  showOnline: true,
};

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

test("a member's choice is saved on the account and kept in the cookie the page script reads", async () => {
  const asked = backend(true);
  expect(await saveTheme("dark")).toEqual({ ok: true });
  expect(asked.at(-1)).toMatchObject({
    method: "PATCH",
    path: "/api/v1/me/preferences",
    body: { theme: "dark" },
  });
  expect(cookieSets).toHaveLength(1);
  expect(cookieSets[0]?.slice(0, 2)).toEqual(["sermo-account-theme", "dark"]);
  expect(cookieSets[0]?.[2]).toMatchObject({
    httpOnly: false,
    sameSite: "lax",
    path: "/",
  });
});

test("a guest writes nothing and drops a cookie left by an ended session", async () => {
  const asked = backend(false);
  expect(await saveTheme("dark")).toEqual({ ok: true });
  expect(asked.some((call) => call.path.includes("preferences"))).toBe(false);
  expect(cookieSets).toEqual([]);
  expect(cookieDeletes).toEqual(["sermo-account-theme"]);
});

test("a member whose group may not edit their profile keeps the browser's choice", async () => {
  const asked = backend(true, undefined, { "profile.editOwn": false });
  expect(await saveTheme("dark")).toEqual({ ok: true });
  expect(asked.some((call) => call.path.includes("preferences"))).toBe(false);
  expect(cookieSets).toEqual([]);
  expect(cookieDeletes).toEqual(["sermo-account-theme"]);
});

test("a refusal comes back as the backend's message and the cookie is not changed", async () => {
  backend(
    true,
    Response.json(
      { error: { code: "conflict", message: "Try again." } },
      { status: 409 },
    ),
  );
  expect(await saveTheme("dark")).toEqual({ ok: false, error: "Try again." });
  expect(cookieSets).toEqual([]);
  expect(cookieDeletes).toEqual([]);
});

test("a theme that is not one is refused before anything is sent", async () => {
  const asked = backend(true);
  expect((await saveTheme("sepia")).ok).toBe(false);
  expect(asked).toEqual([]);
  expect(cookieSets).toEqual([]);
});

test("the cookie for a theme the browser took from the account is written for the page script", async () => {
  const { rememberTheme } = await import(source);
  await rememberTheme("dark");
  await rememberTheme("sepia");
  expect(cookieSets).toHaveLength(1);
  expect(cookieSets[0]?.slice(0, 2)).toEqual(["sermo-account-theme", "dark"]);
});

test("a cookie that no signed-in account claims is dropped", async () => {
  const { forgetTheme } = await import(source);
  await forgetTheme();
  expect(cookieDeletes).toEqual(["sermo-account-theme"]);
});
