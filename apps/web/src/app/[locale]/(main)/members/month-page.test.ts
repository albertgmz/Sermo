import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { viewerBody } from "@/lib/test-viewer";

const realFetch = globalThis.fetch;
mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, toString: () => "" }),
}));
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async () => (key: string) => key,
}));
const { viewerOfRequest } = await import("@/lib/sermo/client");
const { monthHref, monthPage, monthParam } = await import("./month-page");
const { moreMonth } = await import("./more-members");

beforeEach(() => {
  mock.module("@/lib/sermo/session", () => ({ getViewer: viewerOfRequest }));
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

// The standing answers one member for the month asked for, whatever it is, and the visitor is a
// guest. The months asked for are recorded.
function backend() {
  const months: (string | null)[] = [];
  globalThis.fetch = (async (url: string) => {
    const { pathname, searchParams } = new URL(url);
    if (pathname === "/api/v1/me") return Response.json(viewerBody(false));
    months.push(searchParams.get("month"));
    return Response.json({
      items: [
        {
          card: {
            id: 3,
            username: "ana",
            avatar: null,
            frame: null,
            nameColor: null,
            nameIcon: null,
            title: "",
            badges: [],
            level: 1,
            restricted: false,
          },
          posts: 1,
          reactions: 0,
          referrals: 0,
          points: 1,
        },
      ],
      nextCursor: null,
      year: 2025,
      month: 6,
      scoring: { postPoints: 1, reactionsPerPoint: 10, referralPoints: 20 },
    });
  }) as unknown as typeof fetch;
  return months;
}

test("the month of an address is YYYY-MM or current, and anything else is no month", () => {
  expect(monthParam("2025-06")).toBe("2025-06");
  expect(monthParam("current")).toBe("current");
  for (const odd of ["", "2025-6", "2025-13", "June", undefined, null, 5])
    expect(monthParam(odd), String(odd)).toBeUndefined();
});

test("the standing of the default month and any other are on the one page", () => {
  expect(monthHref()).toBe("/members/month");
  expect(monthHref("2025-06")).toBe("/members/month?month=2025-06");
});

test("a page of the standing asks for the month named, else the last complete one", async () => {
  const months = backend();
  const named = await monthPage(undefined, "2025-06");
  expect([named.year, named.month]).toEqual([2025, 6]);
  expect(named.rows).toHaveLength(1);
  await monthPage();
  expect(months).toEqual(["2025-06", "previous"]);
});

test("the action that the browser calls asks for the month the list was drawn for, and reads it as an address is", async () => {
  const months = backend();
  await moreMonth("2025-06", null);
  await moreMonth(null, null);
  await moreMonth("../../x", null);
  expect(months).toEqual(["2025-06", "previous", "previous"]);
});
