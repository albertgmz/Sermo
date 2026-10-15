import { afterAll, afterEach, beforeEach, expect, mock, test } from "bun:test";
import { renderToReadableStream } from "react-dom/server";
import { messages } from "@/i18n/messages";
import { translator, withIntl } from "@/lib/test-intl";
import { viewerBody } from "@/lib/test-viewer";

const realFetch = globalThis.fetch;

mock.module("server-only", () => ({}));
const intl = await import("next-intl/server");
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async (namespace: string) => translator(namespace),
}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, toString: () => "" }),
}));

const { viewerOfRequest } = await import("@/lib/sermo/client");
const { default: AwardPage } = await import("./page");

afterAll(() => {
  mock.module("next-intl/server", () => intl);
});
// Another test file leaves a stand-in for the viewer in place: the page asks the backend.
beforeEach(() => {
  mock.module("@/lib/sermo/session", () => ({ getViewer: viewerOfRequest }));
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const STAMP = "2026-01-01T00:00:00.000Z";

const award = {
  id: 1,
  name: "Award 1",
  description: "",
  icon: "star",
  image: null,
  tier: "gold",
  xp: 10,
  credits: 0,
  isStackable: false,
  isActive: true,
  rule: { match: "all", conditions: [] },
  grantCount: 0,
  createdAt: STAMP,
  updatedAt: STAMP,
};

// The backend refuses awards.holders to a viewer whose group lacks member.viewList.
function backend(viewList: boolean) {
  globalThis.fetch = (async (url: string) => {
    const { pathname } = new URL(url);
    if (pathname === "/api/v1/me") {
      return Response.json({
        ...viewerBody(false),
        resolvedPermissions: viewList ? {} : { "member.viewList": false },
      });
    }
    if (pathname === "/api/v1/awards/1") return Response.json(award);
    if (pathname === "/api/v1/awards/1/holders") {
      if (viewList) return Response.json({ items: [], nextCursor: null });
      return Response.json(
        { error: { code: "forbidden", message: "Not for you." } },
        { status: 403 },
      );
    }
    return Response.json(
      { error: { code: "not_found", message: "?" } },
      { status: 404 },
    );
  }) as unknown as typeof fetch;
}

async function page() {
  const errors: unknown[] = [];
  const node = await AwardPage({
    params: Promise.resolve({ locale: "en", id: "1" }),
    searchParams: Promise.resolve({}),
  } as unknown as Parameters<typeof AwardPage>[0]);
  const stream = await renderToReadableStream(withIntl(node), {
    onError: (error) => {
      errors.push(error);
    },
  });
  await stream.allReady;
  return { html: await new Response(stream).text(), errors };
}

test("a viewer who may not list members gets the award without the holders, and no error", async () => {
  backend(false);
  const { html, errors } = await page();
  expect(errors).toEqual([]);
  expect(html).toContain("Award 1");
  expect(html).not.toContain(messages.awards.award.holdersHeading);
});

test("the holders are there for a viewer who may list members", async () => {
  backend(true);
  const { html, errors } = await page();
  expect(errors).toEqual([]);
  expect(html).toContain(messages.awards.award.holdersHeading);
});
