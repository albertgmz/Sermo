import { afterEach, expect, mock, spyOn, test } from "bun:test";
import { readFileSync } from "node:fs";
import { widgetBody } from "@/lib/test-bodies";
import { viewerBody } from "@/lib/test-viewer";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

let incoming = new Headers();
mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  headers: async () => incoming,
  cookies: async () => ({ get: () => undefined, toString: () => "" }),
}));

const { getWidgets } = await import("./widgets");

const session = (token: string) => `sermo.session_token=${token}`;

// Each visitor's widgets: the one named in their session cookie, so an answer kept for one visitor
// and given to another shows. Every request to the widgets is recorded with what it carried.
type Sent = { cookie: string | null; cache: RequestCache | undefined };
const sent: Sent[] = [];
function backend() {
  sent.length = 0;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    const { pathname } = new URL(url);
    const cookie = new Headers(init.headers).get("cookie");
    if (pathname === "/api/v1/me") return Response.json(viewerBody(true));
    sent.push({ cookie, cache: init.cache });
    const id = cookie?.includes("ana") ? 1 : 2;
    return Response.json({
      items: [
        widgetBody({ id, position: "forum_list_above", type: "featured" }),
      ],
    });
  }) as unknown as typeof fetch;
}

test("each visitor's widgets are asked with their own session, never from a shared store", async () => {
  backend();
  incoming = new Headers({ cookie: session("ana") });
  const ana = await getWidgets("home");
  incoming = new Headers({ cookie: session("ben") });
  const ben = await getWidgets("home");
  expect(ana.map(({ id }) => id)).toEqual([1]);
  expect(ben.map(({ id }) => id)).toEqual([2]);
  expect(sent.map(({ cookie }) => cookie)).toEqual([
    session("ana"),
    session("ben"),
  ]);
  expect(sent.every(({ cache }) => cache === "no-store")).toBe(true);
});

// The rules of a widget are about the viewer: an answer cached for everyone would show one visitor
// what was decided for another.
test("the widgets are read in no cache shared between requests", () => {
  const source = readFileSync(`${import.meta.dir}/widgets.ts`, "utf8");
  for (const shared of [
    "use cache",
    "unstable_cache",
    "cacheTag",
    "cacheLife",
    "revalidate",
    "force-cache",
  ])
    expect(source, shared).not.toContain(shared);
  expect(source).toContain("call(widgetsCurrent");
});

test("a backend that fails or cannot be reached leaves the page without widgets, and is logged", async () => {
  const log = spyOn(console, "error").mockImplementation(() => {});
  const phase = process.env.NEXT_PHASE;
  try {
    process.env.NEXT_PHASE = "phase-production-server";
    incoming = new Headers();
    globalThis.fetch = (async (url: string) =>
      new URL(url).pathname === "/api/v1/me"
        ? Response.json(viewerBody(false))
        : Response.json(
            { error: { code: "internal", message: "Broken." } },
            { status: 500 },
          )) as unknown as typeof fetch;
    expect(await getWidgets("novedades")).toEqual([]);
    globalThis.fetch = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    expect(await getWidgets("novedades")).toEqual([]);
    expect(
      log.mock.calls.filter(([line]) =>
        String(line).includes("widgets could not be read"),
      ),
    ).toHaveLength(2);
  } finally {
    process.env.NEXT_PHASE = phase;
    log.mockRestore();
  }
});

test("an error that is not the API's is passed on", async () => {
  incoming = new Headers();
  const own = new Error("a prerender stopped on purpose");
  globalThis.fetch = (async () => {
    throw own;
  }) as unknown as typeof fetch;
  await expect(getWidgets("home")).rejects.toBe(own);
});
