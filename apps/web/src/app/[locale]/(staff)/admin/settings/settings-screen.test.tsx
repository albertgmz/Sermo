import { afterAll, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { withIntl } from "@/lib/test-intl";

// The links read their words through the library's hook and the provider of `withIntl`, whatever
// stand-in another suite left in place for it.
const nextIntl = await import("next-intl");
const useIntl = await import("use-intl");
mock.module("next-intl", () => ({
  ...nextIntl,
  useLocale: () => "en",
  useTranslations: useIntl.useTranslations,
}));
mock.module("server-only", () => ({}));
afterAll(() => {
  mock.module("next-intl", () => nextIntl);
});
const { SettingsGroups } = await import("./settings-screen");

const draw = (current: Parameters<typeof SettingsGroups>[0]["current"]) =>
  renderToStaticMarkup(withIntl(<SettingsGroups current={current} />));

const GROUPS = [
  ["General", "/admin/settings"],
  ["What&#x27;s new", "/admin/settings/home"],
  ["New members", "/admin/settings/members"],
  ["Anti-spam", "/admin/settings/antispam"],
  ["Uploads", "/admin/settings/uploads"],
  ["Search engines", "/admin/settings/seo"],
  ["Levels", "/admin/settings/levels"],
  ["Cookies and privacy", "/admin/settings/cookies"],
  ["Site identity", "/admin/settings/identity"],
];

test("the switcher links every option group, in order, and marks the open one", () => {
  const html = draw("antispam");
  const links = [...html.matchAll(/<a [^>]*href="([^"]+)"[^>]*>([^<]*)</g)];
  expect(links.map(([, href, label]) => [label, href])).toEqual(GROUPS);
  expect(html.match(/aria-current="page"/g)).toHaveLength(1);
  expect(html).toMatch(/aria-current="page"[^>]*>Anti-spam</);
  expect(html).toContain('aria-label="Settings groups"');
});

test("the identity page is a group of the switcher too", () => {
  expect(draw("identity")).toMatch(/aria-current="page"[^>]*>Site identity</);
});
