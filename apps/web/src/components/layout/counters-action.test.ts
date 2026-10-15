import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { itemChanges } from "@/lib/item-state";

const realFetch = globalThis.fetch;
mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  headers: async () => new Headers({ cookie: "sermo.session_token=abc" }),
  cookies: async () => ({ get: () => undefined, toString: () => "" }),
}));
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async () => (key: string) => key,
}));
const { readCounters } = await import("./counters-action");
const { publishCounters } = await import("@/lib/counters");
const { shownValue } = await import("@/lib/item-state");

beforeEach(() => itemChanges.clear());
afterEach(() => {
  globalThis.fetch = realFetch;
});

test("the counters are one request, and only the two unread counts are kept", async () => {
  const asked: string[] = [];
  globalThis.fetch = (async (url: string) => {
    asked.push(new URL(url).pathname);
    return Response.json({
      conversations: 2,
      notifications: 5,
      openReports: { count: 1, more: false, cap: 99 },
      pendingApprovals: { count: 0, more: false, cap: 99 },
    });
  }) as unknown as typeof fetch;
  expect(await readCounters()).toEqual({ conversations: 2, notifications: 5 });
  expect(asked).toEqual(["/api/v1/me/counters"]);
});

test("a session that ended stops polling", async () => {
  globalThis.fetch = (async () =>
    Response.json(
      { error: { code: "unauthenticated", message: "no" } },
      { status: 401 },
    )) as unknown as typeof fetch;
  expect(await readCounters()).toEqual({ stop: true });
});

test("what a poll found shows while the page still holds what it drew, and the page wins after it is drawn again", () => {
  publishCounters(
    { conversations: 0, notifications: 1 },
    { conversations: 3, notifications: 1 },
  );
  const of = (kind: string, drawn: number) =>
    shownValue(itemChanges.get(`counter:${kind}`) as never, drawn);
  expect(of("conversations", 0)).toBe(3);
  expect(of("notifications", 1)).toBe(1);
  // Opening the conversation drew the page again with the count cleared.
  expect(of("conversations", 2)).toBe(2);
});
