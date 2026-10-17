import { expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { withIntl } from "@/lib/test-intl";
import en from "../../../messages/en/layout.json";
import es from "../../../messages/es/layout.json";

// The link reads its words through the library's hook and the provider of `withIntl`, whatever
// stand-in another suite left in place for it.
const nextIntl = await import("next-intl");
const useIntl = await import("use-intl");
mock.module("next-intl", () => ({
  ...nextIntl,
  useTranslations: useIntl.useTranslations,
}));

const { MAIN_ID, SkipLink } = await import("./skip-link");
const { SkipLinkAnchor } = await import("./skip-link-anchor");

// Every frame with a header and a `<main>`: the forum, the staff panel and the developer page.
const FRAMES = ["(main)", "(staff)", "(developer)"].map((group) =>
  readFileSync(
    join(import.meta.dir, `../../app/[locale]/${group}/layout.tsx`),
    "utf8",
  ),
);

test("the skip link leads to the main element's id, in the visitor's language", () => {
  const html = renderToStaticMarkup(withIntl(<SkipLink />));
  expect(html).toContain(`href="#${MAIN_ID}"`);
  expect(html).toContain(">Skip to main content</a>");
  expect(es.skipLink.label).toBe("Ir al contenido principal");
  expect(es.skipLink.label).not.toBe(en.skipLink.label);
});

test("the skip link is out of sight until it holds the focus, and never display:none", () => {
  const html = renderToStaticMarkup(withIntl(<SkipLink />));
  const classes = html.match(/class="([^"]*)"/)?.[1].split(" ") ?? [];
  expect(classes).toContain("-translate-y-20");
  expect(classes).toContain("focus:translate-y-0");
  expect(classes).not.toContain("hidden");
  expect(classes).not.toContain("sr-only");
});

test("pressing the skip link moves the focus to the main element itself, whatever another script does with the click", () => {
  const focused: string[] = [];
  const globals = globalThis as Record<string, unknown>;
  const held = globals.document;
  globals.document = {
    getElementById: (id: string) =>
      id === MAIN_ID ? { focus: () => focused.push(id) } : null,
  };
  try {
    const link = SkipLinkAnchor({ target: MAIN_ID, children: "Skip" });
    expect(link.props.href).toBe(`#${MAIN_ID}`);
    // The handler neither cancels the browser's own jump nor needs it.
    link.props.onClick();
    expect(focused).toEqual([MAIN_ID]);
  } finally {
    globals.document = held;
  }
});

test("each frame draws the skip link before anything else and one main element it leads to", () => {
  for (const layout of FRAMES) {
    // The first child of the frame's outer element, ahead of the notices, the header and its menus.
    expect(layout).toMatch(/\]\}\s*>\s*<div[^>]*>\s*<SkipLink \/>/);
    expect(layout.match(/<SkipLink \/>/g)).toHaveLength(1);
    expect(layout.match(/<main\b/g)).toHaveLength(1);
    // Focusable by script only, so following the link moves the focus and not only the scroll.
    expect(layout).toMatch(/<main\s+id=\{MAIN_ID\}\s+tabIndex=\{-1\}/);
  }
});
