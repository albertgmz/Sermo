import { afterEach, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { siteBody } from "../src/lib/test-bodies";
import { withIntl } from "../src/lib/test-intl";
import { LOCALE_DIRS } from "./locales";

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
  getLocale: async () => "en",
  getTranslations: async () =>
    Object.assign((key: string) => key, { rich: (key: string) => key }),
}));

const { FooterColumns, FooterDescription, FooterSocials, SiteFooter } =
  await import("../src/components/layout/site-footer");

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

const link = (
  id: number,
  title: string,
  target: string | null,
  icon: { icon: string | null; iconPosition: "before" | "after" } = {
    icon: null,
    iconPosition: "before",
  },
) => ({
  id,
  title,
  target,
  builtin: null,
  ...icon,
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

test("a link draws its own icon on the side it asks for, and none without one", async () => {
  backend({
    ...none,
    footer: [
      {
        ...link(1, "Around", null),
        children: [
          link(2, "Boards", "/forums", {
            icon: "star",
            iconPosition: "before",
          }),
          link(3, "Chat", "/chat", { icon: "heart", iconPosition: "after" }),
          link(4, "Rules", "/rules"),
          link(5, "Odd", "/odd", {
            icon: "no-such-icon",
            iconPosition: "before",
          }),
        ],
      },
    ],
  });
  const html = renderToStaticMarkup(await FooterColumns());
  expect(html).toMatch(
    /<span[^>]*><svg[^>]*lucide-star[^>]*>.*<[/]svg><[/]span>Boards<[/]a>/,
  );
  expect(html).toMatch(/Chat<span[^>]*><svg[^>]*lucide-heart/);
  expect(html).toContain(">Rules</a>");
  expect(html).toContain(">Odd</a>");
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

test("the footer says nothing about the site when it has no description", async () => {
  backend({ ...none, footer: [] });
  expect(renderToStaticMarkup(await FooterDescription())).toBe("");
});

test("the copyright names the site and carries no year", () => {
  for (const locale of LOCALE_DIRS) {
    const source = readFileSync(
      new URL(`../messages/${locale}/layout.json`, import.meta.url),
      "utf8",
    );
    const { siteFooter } = JSON.parse(source) as {
      siteFooter: Record<string, string>;
    };
    expect(siteFooter.copyright, locale).toContain("{site}");
    expect(siteFooter.copyright, locale).not.toMatch(/\d{4}/);
    expect(siteFooter.tagline, locale).toBeUndefined();
  }
});

test("the footer's last row holds the language choices beside the theme choices, in the page's first bytes", async () => {
  backend({ ...none, footer: [] });
  // A synchronous render draws each part that waits for data as its fallback: what is left is what
  // the page sends before any script, which is where the language choices must be.
  const html = renderToStaticMarkup(withIntl(<SiteFooter />));
  expect(html).toMatch(/<form id="language"[^>]* action="\/language"/);
  expect(html).toContain('aria-label="Language"');
  expect(html).toContain('aria-label="Theme"');
  expect(html.indexOf('action="/language"')).toBeLessThan(
    html.indexOf('aria-label="Theme"'),
  );
  // The copyright, which waits for the site, is not.
  expect(html).not.toContain(">copyright<");
});
