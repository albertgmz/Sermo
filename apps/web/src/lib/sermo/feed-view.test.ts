import { afterEach, expect, mock, test } from "bun:test";
import { viewerBody } from "@/lib/test-viewer";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  stored = undefined;
});

let stored: string | undefined;
mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({
    get: () => (stored === undefined ? undefined : { value: stored }),
    toString: () => "",
  }),
}));
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async () => (key: string) => key,
}));

const source = "./feed-view.ts?reader";
const { getFeedView } = (await import(source)) as typeof import("./feed-view");

function backend(user: { feedView: string } | null) {
  globalThis.fetch = (async () => {
    const body = viewerBody(user !== null);
    return Response.json(
      user && body.user ? { ...body, user: { ...body.user, ...user } } : body,
    );
  }) as unknown as typeof fetch;
}

test("a member is drawn the layout their account holds, whatever a cookie says", async () => {
  stored = "cards";
  backend({ feedView: "compact" });
  expect(await getFeedView()).toBe("compact");
});

test("a guest is drawn the layout their cookie holds, cards without one or with a bad one", async () => {
  backend(null);
  expect(await getFeedView()).toBe("cards");
  stored = "compact";
  expect(await getFeedView()).toBe("compact");
  stored = "grid";
  expect(await getFeedView()).toBe("cards");
});
