import { afterAll, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { withIntl } from "@/lib/test-intl";

const actions = await import("@/app/[locale]/(auth)/actions");
mock.module("@/app/[locale]/(auth)/actions", () => ({
  register: async () => ({ error: "", username: "" }),
}));

const { RegisterForm } = await import("./register-form");

afterAll(() => {
  mock.module("@/app/[locale]/(auth)/actions", () => actions);
});

const draw = (pages: "both" | "terms" | "rules" | "none") =>
  renderToStaticMarkup(
    withIntl(<RegisterForm pages={pages} turnstileKey={null} />),
  );

test("the checkbox names and links only the pages the site publishes", () => {
  const both = draw("both");
  expect(both).toContain('href="/terms"');
  expect(both).toContain('href="/rules"');
  expect(both).toContain('href="/privacy"');

  const terms = draw("terms");
  expect(terms).toContain('href="/terms"');
  expect(terms).not.toContain('href="/rules"');

  const rules = draw("rules");
  expect(rules).toContain('href="/rules"');
  expect(rules).not.toContain('href="/terms"');

  const none = draw("none");
  expect(none).not.toContain('href="/terms"');
  expect(none).not.toContain('href="/rules"');
  expect(none).toContain('href="/privacy"');
});
