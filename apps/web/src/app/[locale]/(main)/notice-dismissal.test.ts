import { afterEach, expect, mock, test } from "bun:test";
import { viewerBody } from "@/lib/test-viewer";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  cookieSets.length = 0;
  refreshed = 0;
  stored = undefined;
});

let stored: string | undefined;
const cookieSets: unknown[][] = [];
let refreshed = 0;
mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({
    get: () => (stored === undefined ? undefined : { value: stored }),
    set: (...args: unknown[]) => cookieSets.push(args),
    delete: () => {},
    toString: () => "",
  }),
}));
const nextCache = await import("next/cache");
mock.module("next/cache", () => ({
  ...nextCache,
  refresh: () => {
    refreshed += 1;
  },
}));

const source = "./actions.ts?notices";
const { dismissNotice } = (await import(source)) as typeof import("./actions");

// The backend: auth.me for the visitor and an answer for the dismissal.
function backend(signedIn: boolean, dismissal: Response) {
  const asked: { method: string; path: string }[] = [];
  globalThis.fetch = (async (input: string, init: RequestInit) => {
    const path = new URL(input).pathname;
    asked.push({ method: init.method ?? "GET", path });
    return path.endsWith("/me")
      ? Response.json(viewerBody(signedIn))
      : dismissal.clone();
  }) as unknown as typeof fetch;
  return asked;
}

test("a member's dismissal is written to the backend and the page is drawn again", async () => {
  const asked = backend(true, Response.json({ ok: true }));
  await dismissNotice(4);
  expect(asked.at(-1)).toEqual({
    method: "PUT",
    path: "/api/v1/notices/4/dismissal",
  });
  expect(cookieSets).toEqual([]);
  expect(refreshed).toBe(1);
});

test("a refused dismissal changes nothing", async () => {
  backend(
    true,
    Response.json(
      { error: { code: "not_found", message: "Not found." } },
      { status: 404 },
    ),
  );
  await dismissNotice(4);
  expect(refreshed).toBe(0);
});

test("a guest's dismissal goes to the cookie, keeping the earlier ones, and no write is made", async () => {
  stored = "2.3";
  const asked = backend(false, Response.json({ ok: true }));
  await dismissNotice(4);
  expect(asked.some((call) => call.path.includes("/notices"))).toBe(false);
  expect(cookieSets).toHaveLength(1);
  expect(cookieSets[0]?.slice(0, 2)).toEqual([
    "forum_notices_dismissed",
    "2.3.4",
  ]);
  expect(refreshed).toBe(1);
});

test("an id that is not a record id is refused before anything is sent", async () => {
  const asked = backend(true, Response.json({ ok: true }));
  await expect(dismissNotice(0)).rejects.toThrow();
  expect(asked).toEqual([]);
});
