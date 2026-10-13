import { afterEach, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { siteBody } from "../src/lib/test-bodies";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, toString: () => "" }),
}));
// Bun applies module mocks to the whole run, so these match the ones in the other suites.
const nextCache = await import("next/cache");
mock.module("next/cache", () => ({
  ...nextCache,
  cacheLife: () => {},
  cacheTag: () => {},
}));
mock.module("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
}));

const { FooterColumns, FooterSocials } = await import(
  "../src/components/layout/site-footer"
);

function backend(
  navigation: unknown,
  socialLinks = { discord: null, telegram: null, x: null } as Record<
    string,
    string | null
  >,
) {
  globalThis.fetch = (async (url: string) =>
    Response.json(
      url.includes("/navigation") ? navigation : siteBody({ socialLinks }),
    )) as unknown as typeof fetch;
}

const link = (id: number, title: string, target: string | null) => ({
  id,
  title,
  target,
  builtin: null,
});
const none = { header: [], mobile: [], account: [] };

test("the footer draws a column for each heading and one for the single links", async () => {
  backend({
    ...none,
    footer: [
      {
        ...link(1, "Around", null),
        children: [
          link(2, "Boards", "/forums"),
          link(3, "Chat", "https://chat.example.test/room"),
        ],
      },
      { ...link(4, "Press", "/pages/press"), children: [] },
      { ...link(5, "Empty heading", null), children: [] },
    ],
  });
  const html = renderToStaticMarkup(await FooterColumns());
  expect(html).toContain('aria-label="Around"');
  expect(html).toContain(">Around</h2>");
  expect(html).toMatch(/<a [^>]*href="[/]forums"/);
  expect(html).toMatch(
    /<a [^>]*rel="noopener noreferrer"[^>]*href="https:[/][/]chat[.]example[.]test[/]room"/,
  );
  expect(html).toMatch(/<a [^>]*href="[/]pages[/]press"/);
  expect(html.match(/rel="noopener noreferrer"/g)).toHaveLength(1);
  expect(html).not.toContain("Empty heading");
  expect(html).not.toContain("styleguide");
});

test("without entries the footer has no columns", async () => {
  backend({ ...none, footer: [] });
  const html = renderToStaticMarkup(await FooterColumns());
  expect(html).not.toContain("<nav");
});

test("the social row has one icon for each address set and none otherwise", async () => {
  backend(
    { ...none, footer: [] },
    { discord: "https://discord.gg/example", telegram: null, x: null },
  );
  const html = renderToStaticMarkup(await FooterSocials());
  expect(html.match(/<a /g)).toHaveLength(1);
  expect(html).toContain('href="https://discord.gg/example"');
  expect(html).toContain('rel="noopener noreferrer"');
  expect(html).toContain('aria-label="Discord"');
  expect(html).toContain("<svg");
});

test("with no social address there is no row", async () => {
  backend({ ...none, footer: [] });
  expect(renderToStaticMarkup(await FooterSocials())).toBe("");
});
