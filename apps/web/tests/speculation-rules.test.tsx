import { afterAll, beforeEach, expect, mock, test } from "bun:test";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { LiteState } from "../src/lib/lite-preferences";
import { read } from "./lite-scan";

// The visitor's data saver, as the page reads it from their cookie.
let lite: LiteState = { master: false, blocked: [] };
mock.module("server-only", () => ({}));
const realLiteMode = { ...(await import("../src/lib/lite-mode")) };
mock.module("@/lib/lite-mode", () => ({
  ...realLiteMode,
  getLiteState: async () => lite,
}));
afterAll(() => {
  mock.module("@/lib/lite-mode", () => realLiteMode);
});
beforeEach(() => {
  lite = { master: false, blocked: [] };
});

const { SPECULATION_RULES, SpeculationRulesScript } = await import(
  "../src/components/layout/speculation-rules"
);

// The pattern the browser matches `href_matches` with; Bun has it, the DOM types here do not.
type PatternInit = { pathname?: string; search?: string; baseURL?: string };
declare const URLPattern: new (
  input: string | PatternInit,
  baseURL?: string,
) => { test(input: URL): boolean };

const ORIGIN = "https://forum.test";
const DOCUMENT = `${ORIGIN}/threads/1-here`;

type Pattern = string | PatternInit;
type Condition =
  | { and: Condition[] }
  | { or: Condition[] }
  | { not: Condition }
  | { href_matches: Pattern | Pattern[] }
  | { selector_matches: string | string[] };

// A link as the rules see it: its address, and the selectors it matches on the page.
type Anchor = { href: string; selectors: string[] };

// The part of the browser's matching the rules use: `href_matches` patterns resolve against the
// document's address (so a pattern names this origin only), `selector_matches` against the page.
function matches(condition: Condition, anchor: Anchor): boolean {
  if ("and" in condition) return condition.and.every((c) => matches(c, anchor));
  if ("or" in condition) return condition.or.some((c) => matches(c, anchor));
  if ("not" in condition) return !matches(condition.not, anchor);
  if ("href_matches" in condition)
    return [condition.href_matches]
      .flat()
      .some((pattern) =>
        (typeof pattern === "string"
          ? new URLPattern(pattern, DOCUMENT)
          : new URLPattern({ ...pattern, baseURL: DOCUMENT })
        ).test(new URL(anchor.href, DOCUMENT)),
      );
  return [condition.selector_matches]
    .flat()
    .some((selector) => anchor.selectors.includes(selector));
}

const prefetched = (anchor: Anchor) =>
  SPECULATION_RULES.prefetch.some((rule) =>
    matches(rule.where as Condition, anchor),
  );

const BODY = ".bb-content a[href]";
const inBody = (href: string): Anchor => ({ href, selectors: [BODY] });

test("a link in a post body to a thread or a forum at its own address, or to the forum list, is prefetched", () => {
  for (const href of [
    "/threads/12-a-title",
    "/threads/12-item",
    "/threads/12-a-title?page=3",
    "/threads/12-a-title#post-40",
    "/forums/4-news",
    "/forums",
    `${ORIGIN}/threads/12-a-title`,
  ])
    expect([href, prefetched(inBody(href))]).toEqual([href, true]);
});

test("nothing with a side effect, nothing that redirects, nothing elsewhere and nothing off the site is prefetched", () => {
  for (const href of [
    // A bare id is redirected to the address with the slug: the browser drops such a prefetch.
    "/threads/12",
    "/forums/4",
    "/threads/12?page=2",
    "/threads/12-a-title/edit/40",
    "/threads/12/uploads",
    "/forums/4-news/new",
    "/posts/40",
    "/logout",
    "/api/v1/auth/sign-out",
    "/api/v1/threads/12",
    "/og/thread/12",
    "/og/site",
    "/admin/users",
    "/moderation/reports",
    "/members/3-nova",
    "https://elsewhere.test/threads/12-a-title",
  ])
    expect([href, prefetched(inBody(href))]).toEqual([href, false]);
});

test("a referral link is not prefetched: loading it gives the credit", () => {
  for (const href of [
    "/threads/12-a-title?ref=3",
    "/threads/12-a-title?page=2&ref=3",
    "/forums?ref=3",
  ])
    expect([href, prefetched(inBody(href))]).toEqual([href, false]);
  expect(prefetched(inBody("/threads/12-a-title?page=2&pref=3"))).toBe(true);
});

test("only post-body anchors are prefetched: a next/link Link fetches its own page", () => {
  expect(prefetched({ href: "/threads/12-a-title", selectors: [] })).toBe(
    false,
  );
  // The body class the selector names is the one the post body is drawn with.
  expect(read("src/components/forum/html-content.tsx")).toContain(
    'className={cn("bb-content"',
  );
});

test("the rules prefetch only, on a resting pointer", () => {
  expect(Object.keys(SPECULATION_RULES)).toEqual(["prefetch"]);
  for (const rule of SPECULATION_RULES.prefetch)
    expect(rule.eagerness).toBe("moderate");
});

test("the script carries the nonce and the rules as JSON", async () => {
  const html = renderToStaticMarkup(
    (await SpeculationRulesScript({ nonce: "n0nce" })) as ReactElement,
  );
  expect(html).toStartWith('<script type="speculationrules" nonce="n0nce">');
  const json = html.replace(/^<script[^>]*>/, "").replace(/<\/script>$/, "");
  expect(JSON.parse(json)).toEqual(SPECULATION_RULES);
});

test("a visitor using the data saver gets no rules", async () => {
  lite = { master: true, blocked: [] };
  expect(await SpeculationRulesScript({ nonce: "n" })).toBeNull();
  lite = { master: false, blocked: ["postImages"] };
  expect(await SpeculationRulesScript({ nonce: "n" })).toBeNull();
});

test("the root layout draws the rules with the response's nonce", () => {
  expect(read("src/app/[locale]/layout.tsx")).toContain(
    "<SpeculationRulesScript nonce={nonce} />",
  );
});
