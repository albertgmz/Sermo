import { expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { withIntl } from "@/lib/test-intl";

// The button reads its words through the library's hook and the provider of `withIntl`, whatever
// stand-in another suite left in place for it, and holds the router and the action it calls.
const nextIntl = await import("next-intl");
const useIntl = await import("use-intl");
mock.module("next-intl", () => ({
  ...nextIntl,
  useLocale: () => "en",
  useTranslations: useIntl.useTranslations,
}));
const navigation = await import("next/navigation");
mock.module("next/navigation", () => ({
  ...navigation,
  useRouter: () => ({ refresh() {}, push() {} }),
}));
mock.module("@/app/[locale]/(main)/_feed/view-actions", () => ({
  setFeedView: async () => ({ ok: true }),
}));

const { FeedViewToggle } = await import("./feed-view-toggle");

const draw = (view: "cards" | "compact") =>
  renderToStaticMarkup(withIntl(<FeedViewToggle view={view} />));
const button = (html: string, label: string) =>
  html.match(new RegExp(`<button[^>]*aria-label="${label}"[^>]*>`))?.[0] ?? "";

test("it offers cards and the compact list, with the layout in force pressed", () => {
  const cards = draw("cards");
  expect(button(cards, "Cards")).toContain('aria-pressed="true"');
  expect(button(cards, "Compact list")).toContain('aria-pressed="false"');
  const compact = draw("compact");
  expect(button(compact, "Cards")).toContain('aria-pressed="false"');
  expect(button(compact, "Compact list")).toContain('aria-pressed="true"');
});

test("it is one named group, its buttons are 40px high on a phone, and nothing is announced at rest", () => {
  const html = draw("cards");
  expect(html).toContain("<fieldset");
  expect(html).toContain("Feed layout</legend>");
  expect(button(html, "Cards")).toContain("h-10");
  expect(button(html, "Compact list")).toContain("min-w-10");
  expect(html).toMatch(/<span role="status" class="sr-only"><\/span>/);
});
