import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { renderToReadableStream } from "react-dom/server";
import { messages } from "@/i18n/messages";
import { translator, withIntl } from "@/lib/test-intl";

const realFetch = globalThis.fetch;

mock.module("server-only", () => ({}));
const intl = await import("next-intl/server");
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async (namespace: string) => translator(namespace),
}));
// A guest: the request carries no cookie.
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, toString: () => "" }),
}));

const { Ways } = await import("./ways");

afterAll(() => {
  mock.module("next-intl/server", () => intl);
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

async function ways(items: unknown[]) {
  const asked: { path: string; cookie: string | null }[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    asked.push({
      path: new URL(url).pathname,
      cookie: new Headers(init.headers).get("cookie"),
    });
    return Response.json({ items });
  }) as unknown as typeof fetch;
  const html = await new Response(
    await renderToReadableStream(withIntl(await Ways())),
  ).text();
  return { html, asked };
}

test("a rule shows the title the administrator wrote, its limit and the forums it is limited to", async () => {
  const { html, asked } = await ways([
    {
      title: "Start a <good> thread",
      trigger: "thread_created",
      amount: 5,
      limit: { count: 3, windowHours: 24 },
      forums: [
        { id: 4, title: "Announcements" },
        { id: 9, title: "Help" },
      ],
    },
    {
      title: "Warned",
      trigger: "warning_received",
      amount: -2,
      limit: null,
      forums: [],
    },
  ]);
  expect(asked).toEqual([{ path: "/api/v1/credits/ways", cookie: null }]);
  expect(html).toContain("Start a &lt;good&gt; thread");
  expect(html).toContain(messages.credits.ways.triggers.thread_created);
  expect(html).toContain(messages.credits.ways.limit);
  expect(html).toContain('href="/forums/4"');
  expect(html).toContain('href="/forums/9"');
  // The second rule has neither a limit nor forums.
  const [, second] = html.split("<li ").slice(1);
  expect(second).toContain("Warned");
  expect(second).not.toContain(messages.credits.ways.limit);
  expect(second).not.toContain("/forums/");
});

test("with no rule the block says so", async () => {
  const { html } = await ways([]);
  expect(html).toContain(messages.credits.ways.emptyTitle);
  expect(html).not.toContain("<li ");
});
