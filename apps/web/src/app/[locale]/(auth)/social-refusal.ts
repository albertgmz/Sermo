import {
  SOCIAL_PROVIDERS,
  SOCIAL_SIGN_IN_ERRORS,
  type SocialProvider,
} from "@sermo/core/contracts";
import { getTranslations } from "next-intl/server";

// A provider's own name, the same in every language. X keeps its old id in Better Auth.
export const providerName = (provider: SocialProvider) =>
  provider === "google" ? "Google" : provider === "github" ? "GitHub" : "X";

// The address parameter that names the provider a refused sign-in came back from. Better Auth adds
// the code itself as `error`.
export const VIA_PARAM = "via";

const first = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

export const providerIn = (value: string | string[] | undefined) =>
  SOCIAL_PROVIDERS.find((provider) => provider === first(value));

// The code under `auth.social.errors` for each refusal the backend names. One Tap answers an address
// the provider did not verify with Better Auth's own code.
const SOCIAL_KEYS: Record<string, "noEmail" | "notVerified" | "notLinked"> = {
  [SOCIAL_SIGN_IN_ERRORS.noEmail]: "noEmail",
  [SOCIAL_SIGN_IN_ERRORS.notVerified]: "notVerified",
  EMAIL_NOT_VERIFIED: "notVerified",
  [SOCIAL_SIGN_IN_ERRORS.notLinked]: "notLinked",
};

// The refusals the password forms have words for already, under `auth.actions.errors`.
const FORM_KEYS: Record<
  string,
  "registrationClosed" | "banned" | "rateLimited"
> = {
  [SOCIAL_SIGN_IN_ERRORS.registrationClosed]: "registrationClosed",
  ACCOUNT_BANNED: "banned",
  RATE_LIMITED: "rateLimited",
};

// What the sign-in and sign-up pages say about a provider sign-in that came back refused: `error`
// is the code in the address, `via` the provider, `providers` the ones that are on. Nothing without
// a code. Only fixed words are shown, never what the address says.
export async function socialRefusalText(
  error: string | string[] | undefined,
  via: string | string[] | undefined,
  providers: readonly SocialProvider[],
): Promise<string | undefined> {
  const code = first(error);
  if (!code) return undefined;
  const provider = providerIn(via);
  const forms = await getTranslations("auth.actions.errors");
  if (!provider) return forms("generic");
  if (Object.hasOwn(FORM_KEYS, code)) return forms(FORM_KEYS[code]);
  const t = await getTranslations("auth.social.errors");
  const values = {
    provider: providerName(provider),
    google:
      provider !== "google" && providers.includes("google") ? "yes" : "no",
  };
  return Object.hasOwn(SOCIAL_KEYS, code)
    ? t(SOCIAL_KEYS[code], values)
    : t("generic", values);
}
