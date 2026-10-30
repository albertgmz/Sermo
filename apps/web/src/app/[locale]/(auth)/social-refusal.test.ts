import { afterAll, expect, mock, test } from "bun:test";
import { createTranslator } from "use-intl";
import { messages } from "@/i18n/messages";
import esAuth from "../../../../messages/es/auth.json";

let locale: "en" | "es" = "en";
const intl = await import("next-intl/server");
mock.module("next-intl/server", () => ({
  ...intl,
  getTranslations: async (namespace: string) =>
    createTranslator({
      locale,
      messages: (locale === "en"
        ? messages
        : { auth: esAuth }) as typeof messages,
      namespace: namespace as never,
    }),
}));

const { socialRefusalText } = await import("./social-refusal");

afterAll(() => {
  mock.module("next-intl/server", () => intl);
});

const ALL = ["google", "github", "twitter"] as const;

test("no code in the address, no message", async () => {
  expect(await socialRefusalText(undefined, "github", ALL)).toBeUndefined();
});

test("a provider that shares no address is named, and Google is offered only while it is on", async () => {
  expect(await socialRefusalText("email_not_found", "twitter", ALL)).toBe(
    "Your X account does not share an email address. Sign in with Google or with your password.",
  );
  expect(
    await socialRefusalText("email_not_found", "twitter", ["twitter"]),
  ).toBe(
    "Your X account does not share an email address. Sign in with your password.",
  );
});

test("each refusal of the backend has its own words, and any other code a general one", async () => {
  expect(await socialRefusalText("email_not_verified", "github", ALL)).toBe(
    "Your email address at GitHub is not verified. Verify it there, or sign in another way.",
  );
  // One Tap answers this one with Better Auth's own code.
  expect(await socialRefusalText("EMAIL_NOT_VERIFIED", "google", ALL)).toBe(
    "Your email address at Google is not verified. Verify it there, or sign in another way.",
  );
  expect(await socialRefusalText("account_not_linked", "google", ALL)).toBe(
    "An account with the email address of your Google account already exists. Sign in with your password.",
  );
  expect(await socialRefusalText("REGISTRATION_CLOSED", "github", ALL)).toBe(
    "Registration is closed. New accounts cannot be created right now.",
  );
  for (const code of [
    "state_mismatch",
    "invalid_code",
    "USERNAME_IS_ALREADY_TAKEN",
  ])
    expect(await socialRefusalText(code, "github", ALL)).toBe(
      "Signing in with GitHub did not work. Try again.",
    );
});

test("an address that names no known provider gets the general words of the forms", async () => {
  expect(await socialRefusalText("email_not_found", "facebook", ALL)).toBe(
    "Something went wrong. Try again.",
  );
  expect(
    await socialRefusalText(["account_not_linked", "x"], undefined, ALL),
  ).toBe("Something went wrong. Try again.");
});

test("the words are Spanish for a Spanish visitor", async () => {
  locale = "es";
  try {
    expect(await socialRefusalText("email_not_found", "twitter", ALL)).toBe(
      "Tu cuenta de X no comparte un correo; entra con Google o con tu contraseña.",
    );
    expect(await socialRefusalText("invalid_code", "google", ALL)).toBe(
      "No se pudo entrar con Google. Inténtalo otra vez.",
    );
  } finally {
    locale = "en";
  }
});
