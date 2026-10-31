import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { siteBody } from "@/lib/test-bodies";

// The root layout's head: the browser bar's colour for each theme and the site's search for the
// browser's own search box.
mock.module("server-only", () => ({}));
// next/font is replaced by Next's compiler; outside a build the call has nothing behind it. The
// options of each call are kept for the preload test.
type FontOptions = {
  preload?: boolean;
  fallback?: string[];
  adjustFontFallback?: boolean;
};
const fontOptions: Record<string, FontOptions> = {};
mock.module("next/font/google", () => ({
  Inter: (options: FontOptions) => {
    fontOptions.Inter = options;
    return { variable: "font-inter" };
  },
  Geist_Mono: (options: FontOptions) => {
    fontOptions.Geist_Mono = options;
    return { variable: "font-geist-mono" };
  },
}));
// The nonce is read from the request's headers; a direct call has no request.
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, toString: () => "" }),
}));
const intl = { ...(await import("next-intl/server")) };
mock.module("next-intl/server", () => ({
  ...intl,
  getMessages: async () => ({}),
  getTranslations: async () => (key: string) => key,
}));
const nextCache = { ...(await import("next/cache")) };
mock.module("next/cache", () => ({
  ...nextCache,
  cacheLife: () => {},
  cacheTag: () => {},
}));
const realFetch = globalThis.fetch;

const { default: RootLayout, viewport } = await import("./layout");
const { THEME_COLORS } = await import("@/lib/pwa");
const { OPENSEARCH_URL } = await import("@/lib/opensearch");

afterEach(() => {
  globalThis.fetch = realFetch;
});
afterAll(() => {
  mock.module("next-intl/server", () => intl);
  mock.module("next/cache", () => nextCache);
});

const childrenOf = (node: ReactNode): ReactNode[] =>
  isValidElement(node)
    ? [(node.props as { children?: ReactNode }).children].flat()
    : [];

test("the browser bar takes the light page background, the default theme", () => {
  expect(viewport.themeColor).toBe(THEME_COLORS.light);
  expect(THEME_COLORS).toEqual({ light: "#fafafa", dark: "#151521" });
});

test("the page is drawn light, so a visitor with no choice sees no dark first paint", async () => {
  globalThis.fetch = (async () =>
    Response.json(siteBody())) as unknown as typeof fetch;
  const html = (await RootLayout({
    children: null,
    params: Promise.resolve({ locale: "en" }),
  } as never)) as ReactElement<{ "data-theme"?: string; className?: string }>;
  expect(html.props["data-theme"]).toBe("light");
  expect(html.props.className?.split(" ")).not.toContain("dark");
});

test("the head names the site's search for the browser", async () => {
  globalThis.fetch = (async () =>
    Response.json(siteBody())) as unknown as typeof fetch;
  const html = await RootLayout({
    children: null,
    params: Promise.resolve({ locale: "en" }),
  } as never);
  const head = childrenOf(html).find(
    (node): node is ReactElement =>
      isValidElement(node) && node.type === "head",
  );
  const search = childrenOf(head).find(
    (node) =>
      isValidElement(node) && (node.props as { rel?: string }).rel === "search",
  );
  expect(isValidElement(search) && search.props).toEqual({
    rel: "search",
    type: "application/opensearchdescription+xml",
    title: "Garden Club",
    href: OPENSEARCH_URL,
  });
});

test("only the text font is preloaded: the code font loads when a page shows code", () => {
  // A preload is fetched with the page on every first load, ahead of what the page shows; the
  // code font is on few pages (code, keys, placeholders), so the browser fetches it on use.
  expect(fontOptions.Inter).toBeDefined();
  expect(fontOptions.Inter?.preload ?? true).toBe(true);
  expect(fontOptions.Geist_Mono?.preload).toBe(false);
});

test("until the code font is in, code is drawn in a monospace font of the device", () => {
  // Next puts its adjusted fallback (a proportional Arial face) ahead of the `fallback` list, so
  // it is turned off: the stack is then Geist Mono, the listed fonts, then the `monospace` generic.
  expect(fontOptions.Geist_Mono?.adjustFontFallback).toBe(false);
  expect(fontOptions.Geist_Mono?.fallback?.at(-1)).toBe("monospace");
});
