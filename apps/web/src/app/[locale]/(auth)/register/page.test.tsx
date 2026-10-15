import { afterAll, afterEach, expect, mock, test } from "bun:test";
import type { ReactElement } from "react";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, toString: () => "" }),
}));
const intl = await import("next-intl/server");
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async () => (key: string) => key,
}));
// The form needs the sign-up action, which needs the app router.
const actions = await import("@/app/[locale]/(auth)/actions");
mock.module("@/app/[locale]/(auth)/actions", () => ({
  register: async () => ({ error: "", username: "" }),
}));

const { default: RegisterPage } = await import("./page");
const { RegisterForm } = await import("./register-form");

afterAll(() => {
  mock.module("next-intl/server", () => intl);
  mock.module("@/app/[locale]/(auth)/actions", () => actions);
});

type Answer = "published" | "draft" | "not_found" | "rate_limited" | "down";

function backend(answers: Record<"terms" | "rules", Answer>) {
  globalThis.fetch = (async (input: string) => {
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

// The `pages` prop the page gave the form.
function pagesOf(node: unknown): string | undefined {
  if (node === null || typeof node !== "object") return undefined;
  const element = node as ReactElement<{ children?: unknown; pages?: string }>;
  if (element.type === RegisterForm) return element.props.pages;
  for (const child of [element.props?.children].flat(Infinity)) {
    const found = pagesOf(child);
    if (found) return found;
  }
  return undefined;
}

const draw = async () =>
  pagesOf(await RegisterPage({ searchParams: Promise.resolve({}) } as never));

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
