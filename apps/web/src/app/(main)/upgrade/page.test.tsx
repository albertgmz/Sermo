import {
  afterAll,
  afterEach,
  beforeEach,
  expect,
  mock,
  spyOn,
  test,
} from "bun:test";
import { renderToReadableStream } from "react-dom/server";
import { messages } from "@/i18n/messages";
import { translator, withIntl } from "@/lib/test-intl";
import { viewerBody } from "@/lib/test-viewer";

const realFetch = globalThis.fetch;

mock.module("server-only", () => ({}));
const intl = await import("next-intl/server");
mock.module("next-intl/server", () => ({
  getTranslations: async (namespace: string) => translator(namespace),
}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, toString: () => "" }),
}));
let signedIn = true;

const { viewerOfRequest } = await import("@/lib/sermo/client");
const { default: UpgradePage } = await import("./page");

afterAll(() => {
  mock.module("next-intl/server", () => intl);
});
// The failures the page survives are logged; the log is not what these tests read.
const logged = spyOn(console, "error").mockImplementation(() => {});
// Another test file leaves a stand-in for the viewer in place: the page asks the backend.
beforeEach(() => {
  mock.module("@/lib/sermo/session", () => ({ getViewer: viewerOfRequest }));
});
afterEach(() => {
  logged.mockClear();
  globalThis.fetch = realFetch;
  signedIn = true;
});

const STAMP = "2026-01-01T00:00:00.000Z";

function rank(id: number, price: number) {
  return {
    id,
    categoryId: 1,
    name: `Rank ${id}`,
    description: "",
    icon: "",
    image: null,
    price,
    isActive: true,
    stock: null,
    isConsumable: false,
    isGiftable: false,
    durationSeconds: null,
    effect: { type: "group", groupId: 1 },
    position: id,
    createdAt: STAMP,
    updatedAt: STAMP,
  };
}

// The member holds Rank 2 (200 credits). Rank 3 costs the same, Rank 1 less, Rank 4 more.
const ranks = [rank(1, 100), rank(2, 200), rank(3, 200), rank(4, 300)];

function backend(faq: () => Response) {
  globalThis.fetch = (async (url: string) => {
    const { pathname } = new URL(url);
    if (pathname === "/api/v1/me") return Response.json(viewerBody(signedIn));
    if (pathname === "/api/v1/shop/categories") {
      return Response.json({
        items: [
          {
            id: 1,
            name: "Ranks",
            description: "",
            position: 1,
            isActive: true,
            createdAt: STAMP,
            updatedAt: STAMP,
          },
        ],
      });
    }
    if (pathname === "/api/v1/shop/categories/1/items") {
      return Response.json({ items: ranks, nextCursor: null });
    }
    if (pathname === "/api/v1/shop/inventory") {
      return Response.json({
        items: [
          {
            id: 20,
            userId: 1,
            item: ranks[1],
            state: "active",
            quantity: 1,
            expiresAt: null,
            acquiredAt: STAMP,
            updatedAt: STAMP,
          },
        ],
        nextCursor: null,
      });
    }
    if (pathname === "/api/v1/credits") {
      return Response.json({ items: [], nextCursor: null, balance: 500 });
    }
    if (pathname.startsWith("/api/v1/pages/")) return faq();
    return Response.json(
      { error: { code: "not_found", message: "?" } },
      { status: 404 },
    );
  }) as unknown as typeof fetch;
}

async function page() {
  const errors: unknown[] = [];
  const stream = await renderToReadableStream(
    withIntl(await UpgradePage({ searchParams: Promise.resolve({}) } as never)),
    {
      onError: (error) => {
        errors.push(error);
      },
    },
  );
  await stream.allReady;
  return { html: await new Response(stream).text(), errors };
}

const failing = () =>
  Response.json(
    { error: { code: "internal", message: "Boom." } },
    { status: 500 },
  );

const cardOf = (html: string, name: string) =>
  html.split("<li ").find((card) => card.includes(`>${name}<`)) ?? "";

test("a rank below the one held is not called included and has no button", async () => {
  backend(failing);
  const { html } = await page();
  const below = cardOf(html, "Rank 1");
  expect(below).toContain(messages.upgrade.upgrade.below);
  expect(below).not.toContain("<form");
  expect(html.toLowerCase()).not.toContain("included");
  expect(html).not.toContain("comes with");
});

test("a rank at the price of the one held has no upgrade button either", async () => {
  backend(failing);
  const { html } = await page();
  const same = cardOf(html, "Rank 3");
  expect(same).toContain(messages.upgrade.upgrade.samePrice);
  expect(same).not.toContain("<form");
  // The rank held is marked as such; only the dearer rank can be bought.
  expect(cardOf(html, "Rank 2")).toContain(
    messages.upgrade.upgrade.currentRank,
  );
  const dearer = cardOf(html, "Rank 4");
  expect(dearer).toContain("<form");
});

test("the ranks render without the FAQ when its read fails on the backend's side", async () => {
  backend(failing);
  const { html, errors } = await page();
  expect(html).toContain("Rank 4");
  expect(html).not.toContain('id="faq-title"');
  expect(errors).toEqual([]);
  expect(logged).toHaveBeenCalled();
});

test("a missing FAQ page is no error either, and a guest is asked to log in", async () => {
  signedIn = false;
  backend(() =>
    Response.json(
      { error: { code: "not_found", message: "?" } },
      { status: 404 },
    ),
  );
  const { html, errors } = await page();
  expect(errors).toEqual([]);
  expect(cardOf(html, "Rank 4")).not.toContain("<form");
});
