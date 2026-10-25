import { afterAll, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { messages } from "@/i18n/messages";
import { withIntl } from "@/lib/test-intl";

// Another suite replaces the translator with one that fills no placeholders: use the real one.
const intl = { ...(await import("next-intl")) };
const { useTranslations } = await import("use-intl");
mock.module("next-intl", () => ({ ...intl, useTranslations }));
afterAll(() => {
  mock.module("next-intl", () => intl);
});
const { AdultBadge, adultMarked } = await import("./adult-badge");

const b = messages.forum.adultBadge;

test("the mark draws the figure and reads out its name", () => {
  const html = renderToStaticMarkup(withIntl(<AdultBadge />));
  expect(html).toContain(`<span aria-hidden="true">${b.label}</span>`);
  expect(html).toContain(`<span class="sr-only">${b.name}</span>`);
  // Read out once: no tooltip repeating the name.
  expect(html).not.toContain("title=");
  // Its colour is a theme token, never a fixed one.
  expect(html).toContain("text-destructive");
});

test("an item is marked only while the +18 mode is on, by any of its marks", () => {
  expect(adultMarked(true, false, true)).toBe(true);
  expect(adultMarked(true, true)).toBe(true);
  expect(adultMarked(true, false, false)).toBe(false);
  expect(adultMarked(false, true, true)).toBe(false);
});
