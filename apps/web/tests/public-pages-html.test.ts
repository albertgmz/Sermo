import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  firstHtmlArticle,
  firstHtmlProblem,
  PUBLIC_TEXT_PATHS,
  withoutStreamedBlocks,
} from "../scripts/public-html-lib";

// Every public page that holds fixed text must have it in the first HTML, visible without
// JavaScript, not in a `<div hidden>` block streamed after the shell. Their text is a shared cached
// read, ready before the shell is sent; what is the visitor's own waits in its own boundary.
// `scripts/public-html.ts` checks the same on a running build.

const MAIN = join(import.meta.dir, "../src/app/[locale]/(main)");
const STATIC = join(MAIN, "(static)");
const LIB = join(import.meta.dir, "../src/lib/sermo");
const read = (path: string) => readFileSync(path, "utf8");

// The routes that draw a page's text with `StaticPage`, by address.
const STATIC_PAGE_ROUTES: Record<string, string> = {
  "/privacy": join(STATIC, "privacy/page.tsx"),
  "/terms": join(STATIC, "terms/page.tsx"),
  "/legal": join(STATIC, "legal/page.tsx"),
  "/rules": join(STATIC, "rules/page.tsx"),
  "/contact": join(STATIC, "contact/page.tsx"),
  "/pages/[slug]": join(MAIN, "pages/[slug]/page.tsx"),
};
const COOKIE_POLICY = join(MAIN, "cookies/page.tsx");

// What only the request can tell: a read with the visitor's cookies, or the request itself.
const PER_VISITOR = [
  "call(",
  "read(",
  "getViewer(",
  "getNavigation(",
  "siblingLinks(",
  "headers(",
  "cookies(",
];

const SHELL = `<html><body><main id="main"><div role="status"><article class="max-w-prose"><div class="skeleton"></div></article></div></main>`;
const ARTICLE = `<article class="max-w-prose"><h1>Política de privacidad</h1><p>Actualizado hace 3 d&#237;as</p><div class="prose"><h2>Qué guardamos</h2><p>Solo lo que el foro necesita para funcionar &amp; nada más.</p></div></article>`;

test("a page whose text is only in a streamed hidden block fails the check", () => {
  const streamed = `${SHELL}<div hidden id="S:3"><div class="grid"><div>${ARTICLE}</div></div></div><script>$RC("B:3","S:3")</script></body></html>`;
  expect(firstHtmlProblem(streamed)).toContain("no <h1> text");
});

test("a page with no article at all fails the check", () => {
  expect(firstHtmlProblem("<html><body><main></main></body></html>")).toBe(
    "no <article> outside the streamed blocks",
  );
});

test("a page whose text is in the first HTML passes, with its heading and text read as shown", () => {
  const inline = `<html><body><main id="main">${ARTICLE}</main><div hidden id="S:1"><div><p>Footer links</p></div></div></body></html>`;
  expect(firstHtmlProblem(inline)).toBeNull();
  const article = firstHtmlArticle(inline);
  expect(article?.heading).toBe("Política de privacidad");
  expect(article?.text).toContain("Actualizado hace 3 días");
  expect(article?.text).toContain("funcionar & nada más.");
});

test("a streamed block is cut at its own closing tag, divs inside it counted", () => {
  const html = `<p>before</p><div hidden id="S:0"><div><div>inside</div></div></div><p>after</p>`;
  expect(withoutStreamedBlocks(html)).toBe("<p>before</p><p>after</p>");
});

test("the HTML check covers every fixed address, and every static page route is listed", () => {
  const fixed = [...Object.keys(STATIC_PAGE_ROUTES), "/cookies"].filter(
    (path) => !path.includes("["),
  );
  expect([...PUBLIC_TEXT_PATHS].sort()).toEqual(fixed.sort());
  const staticRoutes = readdirSync(STATIC, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `/${entry.name}`);
  for (const path of staticRoutes)
    expect(STATIC_PAGE_ROUTES).toHaveProperty(path);
});

test("each static page route draws its text with StaticPage", () => {
  for (const [path, file] of Object.entries(STATIC_PAGE_ROUTES))
    expect(read(file), path).toContain("<StaticPage");
});

test("StaticPage reads the text from the shared cache and keeps the visitor's links in their own boundary", () => {
  const source = read(join(STATIC, "static-page.tsx"));
  expect(source).toMatch(
    /const getPage = cache\(\s*async \(slug: string\) => \(await publicPage\(slug\)\)/,
  );
  const page = source.slice(
    source.indexOf("export async function StaticPage("),
  );
  for (const call of PER_VISITOR.filter((name) => name !== "read("))
    expect(page, call).not.toContain(call);
  expect(page).toMatch(/<Suspense\b[^\n]*>\s*<SiblingNav /);
});

test("the cookie policy reads only shared data, its written text from the shared cache first", () => {
  const page = read(COOKIE_POLICY);
  for (const call of PER_VISITOR) expect(page, call).not.toContain(call);
  const text = read(join(LIB, "cookie-policy.ts"));
  expect(text.indexOf("publicPage(")).toBeGreaterThan(-1);
  expect(text.indexOf("publicPage(")).toBeLessThan(text.indexOf("call("));
});

test("the shared reads are cached without the visitor and kept for a week", () => {
  for (const [file, shared] of [
    ["public-page.ts", "callWith({}, pagesGet"],
    ["privacy.ts", "callWith({}, privacyLogRetention"],
  ]) {
    const source = read(join(LIB, file));
    expect(source, file).toContain('"use cache"');
    expect(source, file).toContain(shared);
    expect(source, file).toContain("expire: 604800");
  }
});
