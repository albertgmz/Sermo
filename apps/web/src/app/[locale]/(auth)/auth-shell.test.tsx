import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { renderToReadableStream } from "react-dom/server";
import { messages } from "@/i18n/messages";
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
const headers = await import("next/headers");
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, toString: () => "" }),
}));
const intl = await import("next-intl/server");
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations:
    async (namespace: string) =>
    (key: string, values: Record<string, string> = {}) => {
      let value: unknown = messages;
      for (const part of `${namespace}.${key}`.split(".")) {
        value = (value as Record<string, unknown> | undefined)?.[part];
      }
      return typeof value === "string"
        ? value.replace(/\{(\w+)\}/g, (_, name: string) => values[name] ?? "")
        : key;
    },
}));

const { AuthShell } = await import("./auth-shell");

afterAll(() => {
  mock.module("next-intl/server", () => intl);
  mock.module("next/cache", () => nextCache);
  mock.module("next/headers", () => headers);
});

async function html() {
  globalThis.fetch = (async (input: string) =>
    siteAnswer(input, { name: "Foros Cuba" })) as unknown as typeof fetch;
  // Rendered to the end: the flag waits for the visitor's LITE choice behind a boundary.
  const stream = await renderToReadableStream(
    await AuthShell({
      heading: "Welcome back",
      children: <form data-probe="" />,
    }),
  );
  await stream.allReady;
  return new Response(stream).text();
}

test("every sign-in page shows the site under the Cuban flag before its form", async () => {
  const markup = await html();
  // The flag, the name and the welcome come first (and first in the tab order); the page's own
  // heading and form follow in the main region.
  expect(markup).toMatch(
    /<header[^>]*>[\s\S]*aria-hidden="true"[\s\S]*<\/header><main[^>]*>[\s\S]*<h1[^>]*>Welcome back<\/h1>[\s\S]*<form data-probe=""><\/form>[\s\S]*<\/main>/,
  );
  const header = markup.slice(0, markup.indexOf("</header>"));
  expect(header).toContain('viewBox="0 0 30 15"');
  const home = header.match(/<a ([^>]*)>Foros Cuba<\/a>/)?.[1] ?? "";
  expect(home).toContain('href="/"');
  expect(home).toContain('aria-label="Foros Cuba home"');
  expect(header).toContain(messages.auth.shell.welcome);
  expect(markup.match(/<h1/g)).toHaveLength(1);
});
