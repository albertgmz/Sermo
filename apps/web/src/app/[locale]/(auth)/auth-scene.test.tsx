import { afterAll, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToReadableStream } from "react-dom/server";
import { messages } from "@/i18n/messages";

// The visitor's cookies: a LITE choice that leaves out brand artwork is `forum_lite=brand`.
let cookie = "";
const headers = await import("next/headers");
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, toString: () => cookie }),
}));
const intl = await import("next-intl/server");
mock.module("next-intl/server", () => ({
  getTranslations:
    async (namespace: string) =>
    (key: string): string => {
      let value: unknown = messages;
      for (const part of `${namespace}.${key}`.split("."))
        value = (value as Record<string, unknown> | undefined)?.[part];
      return typeof value === "string" ? value : key;
    },
}));

const { AuthScene } = await import("./auth-scene");

afterAll(() => {
  mock.module("next-intl/server", () => intl);
  mock.module("next/headers", () => headers);
});

// Rendered to the end: the scene waits for the visitor's LITE choice behind a boundary.
async function markup(lite = "") {
  cookie = lite;
  const stream = await renderToReadableStream(<AuthScene />);
  await stream.allReady;
  return (await new Response(stream).text()).replace(
    /^<!--\$-->|<!--\/\$-->$/g,
    "",
  );
}

const css = readFileSync(join(import.meta.dir, "auth-scene.css"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\s+/g, " ");

// The stylesheet without its `@media (prefers-reduced-motion: no-preference) { ... }` blocks:
// what a visitor who asked their device for less motion gets.
function stillCss() {
  let rest = css;
  for (;;) {
    const start = rest.indexOf(
      "@media (prefers-reduced-motion: no-preference) {",
    );
    if (start === -1) return rest;
    let depth = 0;
    let end = rest.indexOf("{", start);
    for (; end < rest.length; end++) {
      if (rest[end] === "{") depth++;
      if (rest[end] === "}" && --depth === 0) break;
    }
    rest = rest.slice(0, start) + rest.slice(end + 1);
  }
}

test("the scene behind the sign-in pages is decoration only: hidden from screen readers, nothing to focus, no picture to load", async () => {
  const html = await markup();
  expect(html).toMatch(/^<div[^>]*aria-hidden="true"/);
  expect(html).not.toMatch(/<(?:img|a|button|input)\b/);
  // The bubbles chatter in the visitor's language (as the markup escapes it).
  const escaped = (text: string) => text.replaceAll("'", "&#x27;");
  expect(html).toContain(escaped(messages.auth.shell.chatter.hello));
  expect(html).toContain(escaped(messages.auth.shell.chatter.cheer));
});

test("with less motion asked for, nothing moves and every bubble rests at its own place", async () => {
  const still = stillCss();
  expect(still).not.toMatch(/animation/);
  expect(css).toMatch(/animation/);
  // Without the motion rules a bubble sits where its own --x and --y put it.
  expect(still).toMatch(
    /\.auth-bubble \{[^}]*left: var\(--x\);[^}]*top: var\(--y\);/,
  );
  const bubbles = [
    ...(await markup()).matchAll(
      /<span class="auth-bubble[^"]*" style="([^"]*)"/g,
    ),
  ];
  expect(bubbles.length).toBeGreaterThan(6);
  for (const [, style] of bubbles) {
    expect(style).toMatch(/--x:\d+%/);
    expect(style).toMatch(/--y:\d+%/);
  }
  // Each resting place is its own: no two bubbles drawn on top of each other.
  const places = bubbles.map(([, style]) =>
    style?.replace(/.*(--x:\d+%).*(--y:\d+%).*/, "$1 $2"),
  );
  expect(new Set(places).size).toBe(places.length);
});

test("a visitor whose LITE mode leaves out brand artwork gets the plain night, without the scene", async () => {
  expect(await markup("forum_lite=brand")).toBe("");
  expect(await markup("forum_lite=all")).toBe("");
  expect(await markup("forum_lite=avatars")).toContain("auth-bubble");
});

test("the flag is never drawn in 3D, which browsers render from a blurred low-resolution copy", () => {
  expect(css).not.toMatch(/perspective|rotate[XY]\(|rotate3d|matrix3d/);
});
