import { afterAll, afterEach, expect, mock, test } from "bun:test";
import type { ReactElement } from "react";
import { siteAnswer } from "@/lib/test-bodies";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

mock.module("server-only", () => ({}));
const nextCache = await import("next/cache");
mock.module("next/cache", () => ({
  ...nextCache,
  cacheLife: () => {},
  cacheTag: () => {},
}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, toString: () => "" }),
}));
const intl = await import("next-intl/server");
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async () => {
    const t = (key: string) => key;
    t.rich = (key: string) => key;
    return t;
  },
}));
const actions = await import("@/app/[locale]/(auth)/actions");
mock.module("@/app/[locale]/(auth)/actions", () => ({
  login: async () => ({ error: "", username: "" }),
}));

const { default: LoginPage } = await import("./page");

afterAll(() => {
  mock.module("next-intl/server", () => intl);
  mock.module("@/app/[locale]/(auth)/actions", () => actions);
  mock.module("next/cache", () => nextCache);
});

// Every string the page put in its tree (the translator answers each key with itself).
function textsOf(node: unknown): string[] {
  if (typeof node === "string") return [node];
  if (node === null || typeof node !== "object") return [];
  const { children } =
    (node as ReactElement<{ children?: unknown }>).props ?? {};
  return [children].flat(Infinity).flatMap(textsOf);
}

const draw = async (registration: { open: boolean }) => {
  globalThis.fetch = (async (input: string) =>
    siteAnswer(input, {
      registration: {
        ...registration,
        approval: false,
        minimumAge: 0,
        fields: [],
      },
    })) as unknown as typeof fetch;
  return textsOf(
    await LoginPage({ searchParams: Promise.resolve({}) } as never),
  );
};

test("the sign-in page offers to create an account while registration is open", async () => {
  expect(await draw({ open: true })).toContain("createAccount");
});

test("the sign-in page does not offer it once registration is closed", async () => {
  expect(await draw({ open: false })).not.toContain("createAccount");
});
