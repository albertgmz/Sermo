import { afterAll, afterEach, beforeEach, expect, mock, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToReadableStream } from "react-dom/server";
import { createFormatter } from "use-intl";
import { translator, withIntl } from "@/lib/test-intl";
import { viewerBody } from "@/lib/test-viewer";

const realFetch = globalThis.fetch;

mock.module("server-only", () => ({}));
const intlServer = await import("next-intl/server");
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getFormatter: async () => createFormatter({ locale: "en", timeZone: "UTC" }),
  getTranslations: async (namespace: string) => translator(namespace, true),
}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, toString: () => "" }),
}));

const { viewerOfRequest } = await import("@/lib/sermo/client");
const { MembersView } = await import("./members-view");

afterAll(() => {
  mock.module("next-intl/server", () => intlServer);
});
beforeEach(() => {
  mock.module("@/lib/sermo/session", () => ({ getViewer: viewerOfRequest }));
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const card = (id: number, username: string) => ({
  id,
  username,
  avatar: null,
  frame: null,
  nameColor: null,
  nameIcon: null,
  title: "",
  badges: [],
  level: 1,
  restricted: false,
});
const entry = (id: number, username: string, points: number) => ({
  card: card(id, username),
  posts: 3,
  reactions: 4,
  referrals: 1,
  points,
});

// The standing of the month asked for lists nobody unless it is June 2025, and the winners are
// those of May and June 2025. The months asked for are recorded.
const months: (string | null)[] = [];
function backend() {
  months.length = 0;
  globalThis.fetch = (async (url: string) => {
    const { pathname, searchParams } = new URL(url);
    if (pathname === "/api/v1/me") return Response.json(viewerBody(false));
    if (pathname === "/api/v1/standings") {
      months.push(searchParams.get("month"));
      const named = /^(\d{4})-(\d{2})$/.exec(searchParams.get("month") ?? "");
      const [year, month] = named
        ? [Number(named[1]), Number(named[2])]
        : [2025, 6];
      return Response.json({
        items: year === 2025 && month === 6 ? [entry(3, "ana", 22)] : [],
        nextCursor: year === 2025 && month === 6 ? "c1" : null,
        year,
        month,
        scoring: { postPoints: 1, reactionsPerPoint: 10, referralPoints: 20 },
      });
    }
    if (pathname === "/api/v1/standings/winners")
      return Response.json({
        items: [
          { ...entry(3, "ana", 22), year: 2025, month: 6 },
          { ...entry(4, "ben", 18), year: 2025, month: 5 },
        ],
      });
    return Response.json({ items: [], nextCursor: null });
  }) as unknown as typeof fetch;
}

async function draw(params: Record<string, string>) {
  const errors: unknown[] = [];
  const stream = await renderToReadableStream(
    withIntl(
      <QueryClientProvider client={new QueryClient()}>
        {await MembersView({ params })}
      </QueryClientProvider>,
    ),
    {
      onError: (error) => {
        errors.push(error);
      },
    },
  );
  await stream.allReady;
  return { html: await new Response(stream).text(), errors };
}

test("the month view lists the month in the address, with its winner and the picker set to it", async () => {
  backend();
  const { html, errors } = await draw({ view: "month", month: "2025-06" });
  expect(errors).toEqual([]);
  expect(months).toEqual(["2025-06"]);
  expect(html).toContain("ana");
  // June's winner is the hero; May's is in the past winners.
  expect(html).toContain("member-of-the-month");
  expect(html).toContain("ben");
  expect(html).toContain('action="/members/month"');
  expect(html).toContain('value="2025-06"');
  // More of the list is asked for the same month, and the plain links go to its address.
  expect(html).toContain("/members/month?month=2025-06&amp;cursor=");
});

test("without a month, the last complete month is the view", async () => {
  backend();
  await draw({ view: "month" });
  expect(months).toEqual(["previous"]);
});

test("a month that nothing is kept for but has a winner shows the winner, not an empty page", async () => {
  backend();
  // May 2025 has no standing in the fake; its winner is in the list of winners.
  const { html } = await draw({ view: "month", month: "2025-05" });
  expect(html).toContain("member-of-the-month");
  expect(html).toContain("ben");
});

test("the picker starts at the oldest winner on record, and an older month says its standing is not kept", async () => {
  backend();
  const picked = await draw({ view: "month", month: "2025-06" });
  expect(picked.html).toContain('min="2025-05"');
  // April 2025 has no standing and no winner, and is older than the last complete month.
  const { html } = await draw({ view: "month", month: "2025-04" });
  expect(html).toContain("The standing of April 2025 is no longer kept.");
  expect(html).not.toContain("Nobody earned points in April 2025.");
});
