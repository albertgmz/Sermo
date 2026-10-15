import { afterAll, expect, mock, test } from "bun:test";
import { ACCOUNT_STATES } from "@sermo/core/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { messages } from "@/i18n/messages";
import { withIntl } from "@/lib/test-intl";

// The tag reads its words through the library's hook and the provider of `withIntl`, whatever
// stand-in another suite left in place for it.
const nextIntl = await import("next-intl");
const useIntl = await import("use-intl");
mock.module("next-intl", () => ({
  ...nextIntl,
  useLocale: () => "en",
  useTranslations: useIntl.useTranslations,
}));
const { MemberState } = await import("./member-state");

afterAll(() => {
  mock.module("next-intl", () => nextIntl);
});

test("every account state the backend lists has a tag with its own words", () => {
  const seen = new Set<string>();
  for (const state of ACCOUNT_STATES) {
    const html = renderToStaticMarkup(withIntl(<MemberState state={state} />));
    const label = messages.adminUsers.states[state];
    expect(label, state).toBeString();
    expect(html, state).toContain(label);
    seen.add(label);
  }
  expect(seen.size).toBe(ACCOUNT_STATES.length);
});

test("an account waiting in the sign-up queue is tagged as awaiting approval", () => {
  expect(ACCOUNT_STATES).toContain("awaiting");
  expect(
    renderToStaticMarkup(withIntl(<MemberState state="awaiting" />)),
  ).toContain("Awaiting approval");
});
