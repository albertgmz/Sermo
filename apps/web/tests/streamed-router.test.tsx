import { expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { type ReactElement, Suspense } from "react";

// A part that streams in behind a placeholder on a page load must not show that placeholder when
// the router draws the page again (a refresh, an address written in the browser): the screen shows
// the part already. The screens whose parts change in place draw them through `Streamed`.

let sent = new Headers();
mock.module("next/headers", () => ({ headers: async () => sent }));
const { Streamed } = await import("@/components/forum/streamed");

const fallback = <p>loading</p>;

test("a page load streams the part behind its placeholder", async () => {
  sent = new Headers({ accept: "text/html" });
  const drawn = (await Streamed({
    fallback,
    children: <p>part</p>,
  })) as ReactElement<{ fallback: unknown }>;
  expect(drawn.type).toBe(Suspense);
  expect(drawn.props.fallback).toBe(fallback);
});

test("the router asking for the page gets the part itself, with no placeholder", async () => {
  sent = new Headers({ rsc: "1" });
  const part = <p>part</p>;
  expect(await Streamed({ fallback, children: part })).toBe(part);
});

test("a part drawn for an in-place switch has no placeholder either", async () => {
  sent = new Headers();
  const part = <p>part</p>;
  expect(await Streamed({ inPlace: true, fallback, children: part })).toBe(
    part,
  );
});

// The screens that hold an in-place switch (tabs, sections, views, filters, shop categories) or
// a list that is drawn again, and the files that draw their parts: none of them uses a bare
// `Suspense`, which would show its placeholder on a router redraw.
const SCREENS = [
  "app/[locale]/(main)/novedades/feed-column.tsx",
  "app/[locale]/(main)/forums/forum-list.tsx",
  "app/[locale]/(main)/forums/forum-stats.tsx",
  "app/[locale]/(main)/members/members-view.tsx",
  "app/[locale]/(main)/members/overview.tsx",
  "app/[locale]/(main)/members/[id]/sections.tsx",
  "app/[locale]/(main)/credits/page.tsx",
  "app/[locale]/(main)/search/page.tsx",
  "app/[locale]/(main)/search/search-body.tsx",
];

test("the screens with parts that change in place draw them through Streamed, not a bare Suspense", () => {
  for (const file of SCREENS) {
    const code = readFileSync(`${import.meta.dir}/../src/${file}`, "utf8");
    expect(code, file).toMatch(/<Streamed\b/);
    expect(code, file).not.toMatch(/<Suspense\b[^>]*fallback=\{[^n]/);
  }
});
