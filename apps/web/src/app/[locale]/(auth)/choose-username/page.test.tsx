import { afterAll, afterEach, expect, mock, test } from "bun:test";
import type { ReactElement } from "react";
import { siteBody } from "@/lib/test-bodies";
import { viewerBody } from "@/lib/test-viewer";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

let cookie = "sermo.session_token=abc";
mock.module("server-only", () => ({}));
const nextCache = await import("next/cache");
mock.module("next/cache", () => ({
  ...nextCache,
  cacheLife: () => {},
  cacheTag: () => {},
}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(cookie ? { cookie } : {}),
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

const { default: ChooseUsernamePage } = await import("./page");
const { ChooseUsernameForm } = await import("./choose-username-form");
const { SignOutForm } = await import("@/components/layout/sign-out-form");

afterAll(() => {
  mock.module("next-intl/server", () => intl);
  mock.module("next/cache", () => nextCache);
});

// auth.me answers a member who needs a username (or not), or a guest.
function backend(user: "needs" | "done" | "guest") {
  globalThis.fetch = (async (input: string) => {
    const { pathname } = new URL(input);
    if (pathname === "/api/v1/site")
      return Response.json(
        siteBody({
          registration: {
            open: true,
            approval: false,
            minimumAge: 13,
            fields: ["location"],
          },
        }),
      );
    if (pathname === "/api/v1/me") {
      if (user === "guest") return Response.json(viewerBody(false));
      const viewer = viewerBody(true);
      return Response.json({
        ...viewer,
        user: {
          ...viewer.user,
          username: "Juan",
          needsUsername: user === "needs",
        },
      });
    }
    // The terms and rules pages: both published.
    return Response.json({
      slug: pathname.split("/").pop(),
      title: "t",
      bodyHtml: "",
      isPublished: true,
      version: 1,
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
  }) as unknown as typeof fetch;
}

const page = (params: Record<string, string> = {}) =>
  ChooseUsernamePage({ searchParams: Promise.resolve(params) } as never);

async function redirectOf(run: () => Promise<unknown>) {
  try {
    await run();
    return null;
  } catch (error) {
    const digest = String((error as { digest?: unknown }).digest);
    if (!digest.startsWith("NEXT_REDIRECT")) throw error;
    return digest.split(";")[2];
  }
}

function formOf(node: unknown): Record<string, unknown> | undefined {
  if (node === null || typeof node !== "object") return undefined;
  const element = node as ReactElement<Record<string, unknown>>;
  if (element.type === ChooseUsernameForm) return element.props;
  for (const child of [element.props?.children].flat(Infinity)) {
    const found = formOf(child);
    if (found) return found;
  }
  return undefined;
}

test("a member who needs a username gets the form, filled in with the name given for now", async () => {
  cookie = "sermo.session_token=abc";
  backend("needs");
  expect(formOf(await page({ next: "/threads/7" }))).toEqual({
    username: "Juan",
    next: "/threads/7",
    pages: "both",
    fields: ["location"],
    minimumAge: 13,
  });
});

test("an evil next is not carried by the form", async () => {
  cookie = "sermo.session_token=abc";
  backend("needs");
  expect(formOf(await page({ next: "https://evil.example/" }))?.next).toBe("/");
});

test("a member with a username of their own goes straight on to a same-site next", async () => {
  cookie = "sermo.session_token=abc";
  backend("done");
  expect(await redirectOf(() => page({ next: "/members/1" }))).toBe(
    "/members/1",
  );
  expect(await redirectOf(() => page({ next: "//evil.example" }))).toBe("/");
});

test("a guest goes to sign in", async () => {
  cookie = "";
  backend("guest");
  expect(await redirectOf(() => page())).toBe("/login");
});

test("a form sent without the page's script draws its refusal", async () => {
  cookie = "sermo.session_token=abc";
  backend("needs");
  expect(formOf(await page({ refused: "usernameTaken" }))?.refusal).toBe(
    "usernameTaken",
  );
});

test("the screen offers a way out: the site's sign-out form, under the choice", async () => {
  cookie = "sermo.session_token=abc";
  backend("needs");
  const tree = await page();
  const children = [
    (tree as ReactElement<{ children?: unknown }>).props.children,
  ].flat(Infinity) as ReactElement<{ children?: unknown }>[];
  const formAt = children.findIndex(
    (child) => child?.type === ChooseUsernameForm,
  );
  const signOutAt = children.findIndex((child) => child?.type === SignOutForm);
  expect(formAt).toBeGreaterThan(-1);
  expect(signOutAt).toBeGreaterThan(formAt);
  expect(textsOf(children[signOutAt])).toContain("signOut");
});

// Every string of a drawn tree (the translator answers each key with itself).
function textsOf(node: unknown): string[] {
  if (typeof node === "string") return [node];
  if (node === null || typeof node !== "object") return [];
  const { children } =
    (node as ReactElement<{ children?: unknown }>).props ?? {};
  return [children].flat(Infinity).flatMap(textsOf);
}
