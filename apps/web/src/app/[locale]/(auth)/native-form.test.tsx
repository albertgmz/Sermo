import { afterAll, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { messages } from "@/i18n/messages";
import { withIntl } from "@/lib/test-intl";
import {
  HYDRATED_FIELD,
  isHydrated,
  REFUSALS,
  refusalIn,
  refusedAddress,
} from "./native-form";

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
const { ResetForm } = await import("./reset-password/reset-form");
const { NotMeForm } = await import("./not-me/not-me-form");
const { ResendForm } = await import("./resend-form");

afterAll(() => {
  mock.module("next-intl/server", () => intl);
});

const draw = (node: React.ReactNode) => renderToStaticMarkup(withIntl(node));

const FORMS = {
  login: (refusal?: string) => (
    <LoginForm next="/" turnstileKey={null} {...(refusal ? { refusal } : {})} />
  ),
  register: (refusal?: string) => (
    <RegisterForm
      turnstileKey={null}
      pages="both"
      {...(refusal ? { refusal } : {})}
    />
  ),
  forgot: (refusal?: string) => (
    <ForgotForm turnstileKey={null} refusal={refusal} />
  ),
  reset: (refusal?: string) => <ResetForm token="tok" refusal={refusal} />,
  notMe: (refusal?: string) => <NotMeForm token="tok" refusal={refusal} />,
  resend: (refusal?: string) => (
    <ResendForm from="login" turnstileKey={null} refusal={refusal} />
  ),
};

for (const [name, form] of Object.entries(FORMS)) {
  test(`the ${name} form is drawn by the server with the hydration field empty`, () => {
    expect(draw(form())).toMatch(
      new RegExp(
        `<input[^>]*type="hidden"[^>]*name="${HYDRATED_FIELD}"[^>]*value=""`,
      ),
    );
  });

  test(`the ${name} form's hydration field is not restored by the browser`, () => {
    const field = draw(form()).match(
      new RegExp(`<input[^>]*name="${HYDRATED_FIELD}"[^>]*>`),
    );
    expect(field?.[0]).toContain('autoComplete="off"');
  });

  test(`the ${name} form shows the refusal an address named, before any script runs`, () => {
    const page = draw(form("Wrong username or password."));
    expect(page).toContain("Wrong username or password.");
    expect(draw(form())).not.toContain("Wrong username or password.");
  });
}

test("only a submit that carries the field as 1 came from the hydrated page", () => {
  const data = new FormData();
  expect(isHydrated(data)).toBe(false);
  data.set(HYDRATED_FIELD, "");
  expect(isHydrated(data)).toBe(false);
  data.set(HYDRATED_FIELD, "1");
  expect(isHydrated(data)).toBe(true);
});

test("an address names a refusal only by one of the known keys", () => {
  expect(refusalIn("rateLimited")).toBe("rateLimited");
  expect(refusalIn(["banned", "generic"])).toBe("banned");
  for (const other of ["", "nope", "constructor", undefined])
    expect(refusalIn(other)).toBeUndefined();
});

test("the address a refused form goes back to carries what the page needs and the refusal", () => {
  expect(refusedAddress("/login", "rateLimited")).toBe(
    "/login?refused=rateLimited",
  );
  expect(refusedAddress("/login", "banned", { next: "/a b" })).toBe(
    "/login?next=%2Fa+b&refused=banned",
  );
});

test("every refusal has its words, in English and in Spanish, and every wording can be named", async () => {
  const spanish = (await import("../../../../messages/es/auth.json")).default;
  const english = Object.keys(messages.auth.actions.errors).sort();
  expect([...REFUSALS].sort()).toEqual(english);
  expect(Object.keys(spanish.actions.errors).sort()).toEqual(english);
});
