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

const { SocialSignIn } = await import("@/app/[locale]/(auth)/social-sign-in");
const { OneTapGate } = await import("@/components/layout/one-tap-gate");

// The props of the first element of `type` in the page's tree.
function propsOf(
  node: unknown,
  type: unknown,
): Record<string, unknown> | undefined {
  if (node === null || typeof node !== "object") return undefined;
  const element = node as ReactElement<Record<string, unknown>>;
  if (element.type === type) return element.props;
  for (const child of [element.props?.children].flat(Infinity)) {
    const found = propsOf(child, type);
    if (found) return found;
  }
  return undefined;
}

const drawSocial = async (
  providers: string[],
  params: Record<string, string> = {},
) => {
  globalThis.fetch = (async (input: string) =>
    siteAnswer(input, {
      socialSignIn: { providers, googleClientId: null },
    })) as unknown as typeof fetch;
  return LoginPage({ searchParams: Promise.resolve(params) } as never);
};

test("the providers that are on go above the password form, with the page to return to", async () => {
  const tree = await drawSocial(["google", "github", "twitter"], {
    next: "/threads/7",
  });
  expect(propsOf(tree, SocialSignIn)).toMatchObject({
    providers: ["google", "github", "twitter"],
    from: "/login",
    next: "/threads/7",
  });
  expect(propsOf(tree, OneTapGate)).toEqual({ next: "/threads/7" });
});

test("with no provider on, the buttons get none and draw nothing, and no refusal is told", async () => {
  const props = propsOf(await drawSocial([]), SocialSignIn);
  expect(props?.providers).toEqual([]);
  expect(props?.refusal).toBeUndefined();
});

test("a provider sign-in that came back refused is told with the buttons", async () => {
  const tree = await drawSocial(["twitter"], {
    error: "email_not_found",
    via: "twitter",
  });
  expect(propsOf(tree, SocialSignIn)?.refusal).toBe("noEmail");
});

test("an evil next is not carried to the buttons", async () => {
  const tree = await drawSocial(["github"], { next: "//evil.example" });
  expect(propsOf(tree, SocialSignIn)?.next).toBe("/");
});

test("a sign-in Better Auth lost (its error page sends it here, without the provider) is told too", async () => {
  const tree = await drawSocial(["google"], { error: "state_not_found" });
  expect(propsOf(tree, SocialSignIn)?.refusal).toBe("expired");
});
