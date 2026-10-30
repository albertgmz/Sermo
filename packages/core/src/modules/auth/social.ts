import { APIError } from "better-auth";
import type { Ctx } from "../../context";
import { SOCIAL_PROVIDERS, type SocialProvider } from "../../contracts/auth";
import { isReservedUsername, isValidUsername, USERNAME_MAX_LENGTH } from "../../db/auth-options";

/*
 * Sign-in with Google, GitHub and X through Better Auth's social providers. The server reads each
 * provider's client id and secret from its environment and hands them over here; a provider
 * without both is off (no route, not offered).
 */

export interface ProviderCredentials {
  clientId: string;
  clientSecret: string;
}

export type SocialSignInConfig = Partial<Record<SocialProvider, ProviderCredentials>>;

const configurations = new WeakMap<Ctx, SocialSignInConfig>();

/** Sets the providers this context offers. Call it before the first request. */
export function configureSocialSignIn(ctx: Ctx, config: SocialSignInConfig): void {
  configurations.set(ctx, config);
}

/** The configured providers (the same object until the configuration changes). */
export function socialSignInConfig(ctx: Ctx): SocialSignInConfig {
  let config = configurations.get(ctx);
  if (!config) {
    config = {};
    configurations.set(ctx, config);
  }
  return config;
}

/** What `site.get` says about the providers: never a secret. */
export function publicSocialSignIn(ctx: Ctx): {
  providers: SocialProvider[];
  googleClientId: string | null;
} {
  const config = socialSignInConfig(ctx);
  return {
    providers: SOCIAL_PROVIDERS.filter((provider) => config[provider] !== undefined),
    googleClientId: config.google?.clientId ?? null,
  };
}

/** The Better Auth endpoints that sign a visitor in through a provider (and may make an account). */
export const SOCIAL_SIGN_IN_PATHS: ReadonlySet<string> = new Set([
  "/sign-in/social",
  "/callback/:id",
  "/one-tap/callback",
]);

/** Better Auth gives an account with no shared address one under this domain (RFC 6761). */
const PLACEHOLDER_EMAIL = /@[^@]+\.placeholder\.invalid$/i;

/** Whether the address is one Better Auth made up because the provider shared none. */
export function isPlaceholderEmail(email: string): boolean {
  return PLACEHOLDER_EMAIL.test(email);
}

/** A run of anything but letters and digits: a word break in a provider's name. */
const WORD_BREAK = /[^\p{L}\p{N}]+/u;

/** The first word of the name if it obeys the registration rule as it is, else null. */
function firstName(name: string): string | null {
  const first = name.normalize("NFC").split(WORD_BREAK).find(Boolean) ?? "";
  return isValidUsername(first) && !isReservedUsername(first) ? first : null;
}

/** How many numbered forms of the name are tried, then how many random ones. */
const NUMBERED_TRIES = 100;
const RANDOM_TRIES = 20;

function numbered(base: string, number: number): string {
  const suffix = String(number);
  return `${base.slice(0, USERNAME_MAX_LENGTH - suffix.length)}${suffix}`;
}

/**
 * A provisional username for an account a provider made: the first word of the provider's name
 * (never the full real name, nor anything from the address, as the account shows it until the
 * member chooses), else "member" and a number. A name in use gets a number: 2, 3 and so on, then
 * random ones, each checked; when none is free the sign-in is refused. The member replaces it with
 * `auth.chooseUsername`.
 */
export function provisionalUsername(ctx: Ctx, name: string): string {
  const first = firstName(name);
  const base = first ?? "member";
  const taken = ctx.sqlite.prepare<{ id: number }, [string]>(
    "SELECT id FROM users WHERE username_key = ?1 UNION ALL SELECT id FROM auth_user WHERE username = ?1",
  );
  const free = (value: string) =>
    isValidUsername(value) && !isReservedUsername(value) && !taken.get(value.toLowerCase());
  if (first && free(first)) return first;
  for (let n = first ? 2 : 1; n <= NUMBERED_TRIES + 1; n++) {
    const value = numbered(base, n);
    if (free(value)) return value;
  }
  for (let n = 0; n < RANDOM_TRIES; n++) {
    const value = numbered(base, 100_000 + Math.floor(Math.random() * 900_000_000));
    if (free(value)) return value;
  }
  throw new APIError("CONFLICT", {
    code: "USERNAME_IS_ALREADY_TAKEN",
    message: "No provisional username is free.",
  });
}
