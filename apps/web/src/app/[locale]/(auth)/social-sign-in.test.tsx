import { afterAll, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { withIntl } from "@/lib/test-intl";

const actions = await import("@/app/[locale]/(auth)/social-actions");
mock.module("@/app/[locale]/(auth)/social-actions", () => ({
  signInWith: async () => {},
}));

const { SocialSignIn } = await import("./social-sign-in");

afterAll(() => {
  mock.module("@/app/[locale]/(auth)/social-actions", () => actions);
});

type Provider = "google" | "github" | "twitter";
const draw = (providers: Provider[], refusal?: string) =>
  renderToStaticMarkup(
    withIntl(
      <SocialSignIn
        providers={providers}
        from="/login"
        next="/threads/7"
        refusal={refusal}
      />,
    ),
  );

const buttons = (html: string) =>
  [...html.matchAll(/name="provider" value="(\w+)"/g)].map((match) => match[1]);

test("with no provider on, nothing is drawn: the page is the password form alone", () => {
  expect(draw([])).toBe("");
  // A refusal for a provider that was turned off meanwhile draws nothing either.
  expect(draw([], "Refused.")).toBe("");
});

test("with Google alone, its button, the divider and nothing else", () => {
  const html = draw(["google"]);
  expect(buttons(html)).toEqual(["google"]);
  expect(html).toContain("Continue with Google");
  expect(html).toContain(">or<");
});

test("with the three on, Google first and full width, then GitHub and X side by side", () => {
  const html = draw(["google", "github", "twitter"]);
  expect(buttons(html)).toEqual(["google", "github", "twitter"]);
  expect(html).toContain('aria-label="Continue with GitHub"');
  expect(html).toContain('aria-label="Continue with X"');
  expect(html).toMatch(/grid-cols-2/);
});

test("each button posts the provider, the page it is on and the page to return to", () => {
  const html = draw(["github"]);
  expect(buttons(html)).toEqual(["github"]);
  expect(html).toContain('name="from" value="/login"');
  expect(html).toContain('name="next" value="/threads/7"');
  expect(html).not.toContain("grid-cols-2");
  expect(html).not.toContain("Continue with Google");
});

test("a refused provider sign-in is told above the buttons", () => {
  const html = draw(["google"], "Refused.");
  expect(html).toMatch(/role="alert"[^>]*>Refused\.</);
  expect(html.indexOf("Refused.")).toBeLessThan(
    html.indexOf("Continue with Google"),
  );
});
