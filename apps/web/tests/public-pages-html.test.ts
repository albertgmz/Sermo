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
// JavaScript, not in a `<div hidden>` block streamed after the shell. These pages live in the
// `(policy)` group, whose layout puts no boundary and no loading screen between the shell and the
// page; what is the visitor's own waits in its own boundary beside the text.
// `scripts/public-html.ts` checks the same on a running build.

const POLICY = join(import.meta.dir, "../src/app/[locale]/(policy)");
const LIB = join(import.meta.dir, "../src/lib/sermo");
const read = (path: string) => readFileSync(path, "utf8");

// The routes that draw a page's text with `StaticPage`, by address.
const STATIC_PAGE_ROUTES: Record<string, string> = {
  "/privacy": join(POLICY, "privacy/page.tsx"),
  "/terms": join(POLICY, "terms/page.tsx"),
  "/legal": join(POLICY, "legal/page.tsx"),
  "/rules": join(POLICY, "rules/page.tsx"),
  "/contact": join(POLICY, "contact/page.tsx"),
  "/pages/[slug]": join(POLICY, "pages/[slug]/page.tsx"),
};
const COOKIE_POLICY = join(POLICY, "cookies/page.tsx");

// Every file under a folder, with its path.
const filesIn = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? filesIn(join(dir, entry.name))
      : [join(dir, entry.name)],
  );

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

test("the HTML check covers every fixed address, and every route of the group is listed", () => {
  const fixed = [...Object.keys(STATIC_PAGE_ROUTES), "/cookies"].filter(
    (path) => !path.includes("["),
  );
  expect([...PUBLIC_TEXT_PATHS].sort()).toEqual(fixed.sort());
  const listed = [...Object.values(STATIC_PAGE_ROUTES), COOKIE_POLICY];
  const pages = filesIn(POLICY).filter((file) => file.endsWith("/page.tsx"));
  expect(pages.sort()).toEqual(listed.sort());
});

test("nothing streams the page behind a loading screen or a boundary around it", () => {
  const files = filesIn(POLICY);
  expect(
    files.filter((file) => /\/(loading|template)\.tsx$/.test(file)),
  ).toEqual([]);
  const layout = read(join(POLICY, "layout.tsx"));
  const main = layout.slice(layout.indexOf("<main"), layout.indexOf("</main>"));
  expect(main).toContain("<AcceptanceGate>{children}</AcceptanceGate>");
  expect(main).not.toContain("<Suspense");
  expect(read(COOKIE_POLICY)).not.toContain("<Suspense");
});

test("each static page route draws its text with StaticPage", () => {
  for (const [path, file] of Object.entries(STATIC_PAGE_ROUTES))
    expect(read(file), path).toContain("<StaticPage");
});

test("StaticPage draws the text without the visitor's reads, and keeps the visitor's links in their own boundary", () => {
  const source = read(join(POLICY, "static-page.tsx"));
  const page = source.slice(
    source.indexOf("export async function StaticPage("),
  );
  for (const call of PER_VISITOR.filter((name) => name !== "read("))
    expect(page, call).not.toContain(call);
  expect(page.match(/<Suspense\b/g)).toHaveLength(1);
  expect(page).toMatch(/<Suspense\b[^\n]*>\s*<SiblingNav /);
});

test("the cookie policy reads only shared data, its written text from the shared cache first", () => {
  const page = read(COOKIE_POLICY);
  for (const call of PER_VISITOR) expect(page, call).not.toContain(call);
  const text = read(join(LIB, "cookie-policy.ts"));
  expect(text.indexOf("publicPage(")).toBeGreaterThan(-1);
  expect(text.indexOf("publicPage(")).toBeLessThan(text.indexOf("call("));
});
