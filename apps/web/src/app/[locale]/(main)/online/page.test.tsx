import { afterAll, afterEach, beforeEach, expect, mock, test } from "bun:test";
import { renderToReadableStream } from "react-dom/server";
import { formattedTranslator, withIntl } from "@/lib/test-intl";
import { viewerBody } from "@/lib/test-viewer";

const realFetch = globalThis.fetch;

mock.module("server-only", () => ({}));
const intl = await import("next-intl/server");
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getFormatter: async () => ({ number: (value: number) => String(value) }),
  getTranslations: async (namespace: string) => formattedTranslator(namespace),
}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, toString: () => "" }),
}));

const { viewerOfRequest } = await import("@/lib/sermo/client");
const { default: OnlinePage } = await import("./page");

afterAll(() => {
  mock.module("next-intl/server", () => intl);
});
beforeEach(() => {
  mock.module("@/lib/sermo/session", () => ({ getViewer: viewerOfRequest }));
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const AT = new Date(Date.now() - 5 * 60_000).toISOString();
const member = {
  type: "member",
  card: {
    id: 7,
    username: "nova",
    avatar: null,
    frame: null,
    nameColor: null,
    nameIcon: null,
    title: "Administrator",
    badges: [],
    level: 1,
    restricted: false,
  },
  robot: null,
  ip: null,
  activity: {
    at: AT,
    hidden: true,
    place: { kind: "thread", target: { id: 5, title: "Welcome" } },
  },
};
const guest = {
  type: "guest",
  card: null,
  robot: null,
  ip: "203.0.113.7",
  activity: { at: AT, hidden: false, place: { kind: "page", target: null } },
};
const robot = {
  type: "robot",
  card: null,
  robot: {
    name: "Google",
    url: "https://support.google.com/webmasters/answer/182072",
  },
  ip: null,
  activity: {
    at: AT,
    hidden: false,
    place: { kind: "forumList", target: null },
  },
};

function backend(items: unknown[], total = items.length) {
  const asked: string[] = [];
  globalThis.fetch = (async (url: string) => {
    const { pathname, search } = new URL(url);
    if (pathname === "/api/v1/me") return Response.json(viewerBody(false));
    if (pathname === "/api/v1/online") {
      asked.push(search);
      const page = Number(new URLSearchParams(search).get("page") ?? 1);
      return Response.json({ items, page, perPage: 25, total });
    }
    return Response.json(
      { error: { code: "not_found", message: "?" } },
      { status: 404 },
    );
  }) as unknown as typeof fetch;
  return asked;
}

async function page(searchParams: Record<string, string> = {}) {
  const stream = await renderToReadableStream(
    withIntl(
      await OnlinePage({
        params: Promise.resolve({ locale: "en" }),
        searchParams: Promise.resolve(searchParams),
      }),
    ),
    { onError: () => {} },
  );
  await stream.allReady;
  return new Response(stream).text();
}

test("current visitors: a member with what they view, a guest with the address staff see, a robot by name", async () => {
  const asked = backend([member, guest, robot]);
  const html = await page();
  expect(asked).toEqual(["?type=all&page=1"]);
  expect(html).toContain("Current visitors");
  for (const tab of ["Everyone", "Members", "Guests", "Robots"])
    expect(html).toContain(tab);
  expect(html).toContain(">nova<");
  expect(html).toContain("Administrator");
  expect(html).toMatch(
    /Viewing thread “<a[^>]*href="\/threads\/5"[^>]*>Welcome<\/a>”/,
  );
  expect(html).toContain("(hidden)");
  expect(html).toContain(">Guest<");
  expect(html).toContain("Viewing a page");
  expect(html).toContain('data-slot="online-ip"');
  expect(html).toContain("203.0.113.7");
  expect(html).toMatch(
    /Robot: <a[^>]*href="https:\/\/support\.google\.com[^"]*"[^>]*>Google<\/a>/,
  );
  expect(html).toContain("Viewing forum list");
  // One page: no pager.
  expect(html).not.toContain("Page 1 of");
});

test("a filter and a page are asked for as the address names them, with a pager in place", async () => {
  const asked = backend([guest], 60);
  const html = await page({ type: "guest", page: "2" });
  expect(asked).toEqual(["?type=guest&page=2"]);
  expect(html).toMatch(
    /aria-current="page"[^>]*href="\/online\?type=guest">Guests/,
  );
  expect(html).toContain("Page 2 of 3");
  expect(html).toContain('href="/online?type=guest"');
  expect(html).toContain('href="/online?type=guest&amp;page=3"');
  // Something the list does not know is the first page of everyone.
  const fallback = backend([]);
  expect(await page({ type: "bots", page: "x" })).toContain("No results.");
  expect(fallback).toEqual(["?type=all&page=1"]);
});
