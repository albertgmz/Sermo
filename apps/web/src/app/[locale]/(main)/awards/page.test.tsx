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
const { default: AwardsPage } = await import("./page");

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

function award(id: number, isActive: boolean) {
  return {
    id,
    name: `Award ${id}`,
    description: "",
    icon: "star",
    image: null,
    tier: "gold",
    xp: 10,
    credits: 0,
    isStackable: false,
    isActive,
    criteria: [],
    grantCount: 0,
    createdAt: STAMP,
    updatedAt: STAMP,
  };
}

// The backend lists inactive awards too to a holder of admin.awards; users.list is answered with
// `members`.
function backend(members: () => Response, awards?: () => Response) {
  globalThis.fetch = (async (url: string) => {
    const { pathname } = new URL(url);
    if (pathname === "/api/v1/me") return Response.json(viewerBody(false));
    if (pathname === "/api/v1/awards") {
      if (awards) return awards();
      return Response.json({ items: [award(1, true), award(2, false)] });
    }
    if (pathname === "/api/v1/members") return members();
    return Response.json(
      { error: { code: "not_found", message: "?" } },
      { status: 404 },
    );
  }) as unknown as typeof fetch;
}

async function page() {
  const errors: unknown[] = [];
  const stream = await renderToReadableStream(withIntl(await AwardsPage()), {
    onError: (error) => {
      errors.push(error);
    },
  });
  await stream.allReady;
  return { html: await new Response(stream).text(), errors };
}

const refused = (status: number, code: string) => () =>
  Response.json({ error: { code, message: "Not for you." } }, { status });

test("an inactive award is left out of the public catalogue", async () => {
  backend(refused(403, "forbidden"));
  const { html } = await page();
  expect(html).toContain("Award 1");
  expect(html).not.toContain("Award 2");
});

test("a guest who may not open profiles gets the catalogue without the ranking, and no error", async () => {
  for (const [status, code] of [
    [403, "forbidden"],
    [401, "unauthenticated"],
  ] as const) {
    backend(refused(status, code));
    const { html, errors } = await page();
    expect(errors, code).toEqual([]);
    expect(html, code).toContain("Award 1");
    expect(html, code).not.toContain(messages.awards.awards.leadersHeading);
  }
});

test("a failure on the backend's side is still raised", async () => {
  backend(refused(500, "internal"));
  const { errors } = await page();
  expect(errors).not.toEqual([]);
});

test("the ranking is there when the backend gives it", async () => {
  backend(() => Response.json({ items: [], nextCursor: null }));
  const { html, errors } = await page();
  expect(errors).toEqual([]);
  expect(html).toContain(messages.awards.awards.leadersHeading);
});

test("a guest who may not open profiles is told so where the catalogue would be, without an error", async () => {
  const refusedList = refused(403, "forbidden");
  backend(refusedList, refusedList);
  const { html, errors } = await page();
  expect(errors).toEqual([]);
  expect(html).toContain(messages.awards.awards.restricted);
});
