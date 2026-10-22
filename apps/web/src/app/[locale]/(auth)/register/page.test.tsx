import { afterAll, afterEach, expect, mock, test } from "bun:test";
import type { ReactElement } from "react";
import { siteAnswer } from "@/lib/test-bodies";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

mock.module("server-only", () => ({}));
const nextCache = await import("next/cache");
// The page reads the site (for the Turnstile key) through the cached site read.
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
// The form needs the sign-up action, which needs the app router.
const actions = await import("@/app/[locale]/(auth)/actions");
mock.module("@/app/[locale]/(auth)/actions", () => ({
  register: async () => ({ error: "", username: "" }),
}));

const { default: RegisterPage } = await import("./page");
const { RegisterForm } = await import("./register-form");
const { AuthShell } = await import("@/app/[locale]/(auth)/auth-shell");

afterAll(() => {
  mock.module("next-intl/server", () => intl);
  mock.module("@/app/[locale]/(auth)/actions", () => actions);
  mock.module("next/cache", () => nextCache);
});

type Answer = "published" | "draft" | "not_found" | "rate_limited" | "down";

function backend(
  answers: Record<"terms" | "rules", Answer>,
  siteOver: Record<string, unknown> = {},
) {
  globalThis.fetch = (async (input: string) => {
    const site = siteAnswer(input, siteOver);
    if (site) return site;
    const slug = new URL(input).pathname.split("/").pop() as "terms" | "rules";
    const answer = answers[slug];
    if (answer === "published" || answer === "draft")
      return Response.json({
        slug,
        title: slug,
        bodyHtml: "",
        isPublished: answer === "published",
        version: 1,
        updatedAt: "2026-01-01T00:00:00.000Z",
      });
    const status = { not_found: 404, rate_limited: 429, down: 500 }[answer];
    return Response.json(
      {
        error: {
          code: answer === "down" ? "internal" : answer,
          message: answer,
        },
      },
      { status },
    );
  }) as unknown as typeof fetch;
}

type FormProps = { pages?: string; fields?: string[]; minimumAge?: number };

// The props the page gave the form, or undefined when it drew none.
function formOf(node: unknown): FormProps | undefined {
  if (node === null || typeof node !== "object") return undefined;
  const element = node as ReactElement<FormProps & { children?: unknown }>;
  if (element.type === RegisterForm) return element.props;
  for (const child of [element.props?.children].flat(Infinity)) {
    const found = formOf(child);
    if (found) return found;
  }
  return undefined;
}

// Every string the page put in its tree (the translator answers each key with itself).
function textsOf(node: unknown): string[] {
  if (typeof node === "string") return [node];
  if (node === null || typeof node !== "object") return [];
  const { children } =
    (node as ReactElement<{ children?: unknown }>).props ?? {};
  return [children].flat(Infinity).flatMap(textsOf);
}

const page = () => RegisterPage({ searchParams: Promise.resolve({}) } as never);
const draw = async () => formOf(await page())?.pages;

test("the form names the pages the site publishes", async () => {
  backend({ terms: "published", rules: "published" });
  expect(await draw()).toBe("both");
  backend({ terms: "published", rules: "not_found" });
  expect(await draw()).toBe("terms");
  backend({ terms: "not_found", rules: "published" });
  expect(await draw()).toBe("rules");
  backend({ terms: "not_found", rules: "not_found" });
  expect(await draw()).toBe("none");
});

test("a page that exists but is not published is left out", async () => {
  backend({ terms: "published", rules: "draft" });
  expect(await draw()).toBe("terms");
});

test("a failure other than not found is an error, not a form that names fewer pages", async () => {
  for (const failure of ["rate_limited", "down"] as const) {
    backend({ terms: "published", rules: failure });
    await expect(draw()).rejects.toThrow();
    backend({ terms: failure, rules: "not_found" });
    await expect(draw()).rejects.toThrow();
  }
});

test("the form is asked for the profile fields and the minimum age the site sets", async () => {
  backend(
    { terms: "published", rules: "published" },
    {
      registration: {
        open: true,
        approval: false,
        minimumAge: 13,
        fields: ["birthday", "location"],
      },
    },
  );
  const form = formOf(await page());
  expect(form?.fields).toEqual(["birthday", "location"]);
  expect(form?.minimumAge).toBe(13);
});

test("a closed site draws its notice and no form", async () => {
  backend(
    { terms: "published", rules: "published" },
    {
      registration: { open: false, approval: false, minimumAge: 0, fields: [] },
    },
  );
  const tree = await page();
  expect(formOf(tree)).toBeUndefined();
  expect(textsOf(tree)).toContain("closed");
});

test("a site that approves new accounts says so above the form", async () => {
  backend(
    { terms: "published", rules: "published" },
    { registration: { open: true, approval: true, minimumAge: 0, fields: [] } },
  );
  expect(textsOf(await page())).toContain("approvalNote");
  backend({ terms: "published", rules: "published" });
  expect(textsOf(await page())).not.toContain("approvalNote");
});

test("the page is drawn in the frame every sign-in page shares, and leads to sign in whether open or closed", async () => {
  for (const open of [true, false]) {
    backend(
      { terms: "published", rules: "published" },
      { registration: { open, approval: false, minimumAge: 0, fields: [] } },
    );
    const tree = (await page()) as ReactElement<{ heading: string }>;
    expect(tree.type).toBe(AuthShell);
    expect(tree.props.heading).toBe("heading");
    expect(textsOf(tree)).toContain("haveAccount");
  }
});
