import { afterAll, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { withIntl } from "@/lib/test-intl";

mock.module("server-only", () => ({}));
const intl = await import("next-intl/server");
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async () => (key: string) => key,
}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ set: () => {}, get: () => undefined }),
}));

const { LoginForm } = await import("./login/login-form");
const { RegisterForm } = await import("./register/register-form");
const { ForgotForm } = await import("./forgot-password/forgot-form");
const { ResendForm } = await import("./resend-form");
const { loadTurnstile } = await import("./turnstile-field");
const { forgetDocumentNonce } = await import("@/lib/document-nonce");

afterAll(() => {
  mock.module("next-intl/server", () => intl);
});

const draw = (node: React.ReactNode) => renderToStaticMarkup(withIntl(node));

const FORMS = {
  login: (key: string | null) => <LoginForm next="/" turnstileKey={key} />,
  register: (key: string | null) => (
    <RegisterForm turnstileKey={key} pages="both" fields={[]} minimumAge={0} />
  ),
  forgot: (key: string | null) => <ForgotForm turnstileKey={key} />,
  resend: (key: string | null) => (
    <ResendForm from="login" turnstileKey={key} />
  ),
};

for (const [name, form] of Object.entries(FORMS)) {
  test(`the ${name} form carries the token field only where the site guards it`, () => {
    expect(draw(form(null))).not.toContain("turnstileToken");
    expect(draw(form("0x4AAA-site"))).toContain('name="turnstileToken"');
  });
}

test("Cloudflare's script is not in the page: the browser fetches it once the widget mounts", () => {
  const page = draw(FORMS.login("0x4AAA-site"));
  expect(page).not.toContain("challenges.cloudflare.com");
  expect(page).not.toContain("turnstile/v0/api.js");
});

test("Cloudflare's script is loaded with the page's nonce", () => {
  const appended: { nonce?: string }[] = [];
  const real = globalThis.document;
  globalThis.document = {
    querySelector: (selector: string) =>
      selector === "script[nonce]" ? { nonce: "n0nce" } : null,
    createElement: () => ({}),
    head: { append: (element: { nonce?: string }) => appended.push(element) },
  } as unknown as Document;
  try {
    void loadTurnstile();
  } finally {
    globalThis.document = real;
    forgetDocumentNonce();
  }
  expect(appended).toHaveLength(1);
  expect(appended[0].nonce).toBe("n0nce");
});
