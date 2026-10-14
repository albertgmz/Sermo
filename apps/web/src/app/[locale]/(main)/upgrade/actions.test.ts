import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { messages } from "@/i18n/messages";
import { translator } from "@/lib/test-intl";

const realFetch = globalThis.fetch;

mock.module("server-only", () => ({}));
const intl = await import("next-intl/server");
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async (namespace: string) => translator(namespace),
}));
const nextCache = await import("next/cache");
mock.module("next/cache", () => ({ ...nextCache, revalidatePath: () => {} }));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ set: () => {} }),
}));

const { buyRank } = await import("./actions");

afterAll(() => {
  mock.module("next-intl/server", () => intl);
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

test("an item that is not a record id is never asked of the backend", async () => {
  const asked: string[] = [];
  globalThis.fetch = (async (url: string) => {
    asked.push(url);
    return Response.json({});
  }) as unknown as typeof fetch;
  for (const id of [0, -1, 2.5, Number.NaN, "3", null, undefined, 2 ** 60]) {
    expect(await buyRank(id as number, {}), String(id)).toEqual({
      error: messages.lib.errors.generic,
    });
  }
  expect(asked).toEqual([]);
});

test("a refusal of the upgrade is the backend's message", async () => {
  globalThis.fetch = (async () =>
    Response.json(
      { error: { code: "conflict", message: "Ranks only go up." } },
      { status: 409 },
    )) as unknown as typeof fetch;
  expect(await buyRank(4, {})).toEqual({ error: "Ranks only go up." });
});
