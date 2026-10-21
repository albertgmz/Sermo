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
    withIntl(
      <RegisterForm
        pages={pages}
        turnstileKey={null}
        fields={[]}
        minimumAge={0}
      />,
    ),
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

const drawFields = (
  fields: ("birthday" | "location" | "about" | "discord")[],
  minimumAge: number,
) =>
  renderToStaticMarkup(
    withIntl(
      <RegisterForm
        pages="none"
        turnstileKey={null}
        fields={fields}
        minimumAge={minimumAge}
      />,
    ),
  );

test("the form asks nothing beyond the account when the site requires no profile field", () => {
  const html = drawFields([], 0);
  for (const name of ["birthday", "location", "about", "discord"])
    expect(html).not.toContain(`name="${name}"`);
});

test("the form asks each required profile field, with its own control", () => {
  const html = drawFields(["birthday", "location", "about", "discord"], 0);
  expect(html).toContain('type="date"');
  expect(html).toContain('name="birthday"');
  expect(html).toContain('name="location"');
  expect(html).toContain('name="discord"');
  expect(html).toMatch(/<textarea[^>]*name="about"/);
  // Every one is required in the browser too.
  const asked = html
    .split("<")
    .filter((tag) => /name="(birthday|location|about|discord)"/.test(tag));
  expect(asked).toHaveLength(4);
  for (const tag of asked) expect(tag).toContain("required");
  expect(html).not.toContain("at least");
});

test("a minimum age is told next to the date of birth", () => {
  expect(drawFields(["birthday"], 13)).toContain(
    "You must be at least 13 years old to register.",
  );
});
