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

/** Characters the username rule refuses become spaces; runs of them become one. */
const REFUSED = /[^\p{L}\p{N}_.\- ]+/gu;
/** Leading and trailing characters that are not letters, numbers or '_'. */
const LOOSE_ENDS = /^[^\p{L}\p{N}_]+|[^\p{L}\p{N}_]+$/gu;

/** The name made to obey the registration rule, or null when nothing usable is left. */
function cleaned(name: string): string | null {
  let value = name.normalize("NFC").replace(REFUSED, " ").replace(/ {2,}/g, " ");
  value = value.slice(0, USERNAME_MAX_LENGTH).replace(LOOSE_ENDS, "");
  return isValidUsername(value) && !isReservedUsername(value) ? value : null;
}

/** How many numbered forms of a taken name are tried before a random one. */
const NUMBERED_TRIES = 20;

/**
 * A provisional username for an account a provider made: the provider's name, else the local part
 * of the address, else "member", made to obey the registration rule, with a number added when the
 * name is in use. The member replaces it with `auth.chooseUsername`.
 */
export function provisionalUsername(ctx: Ctx, name: string, email: string): string {
  const base = cleaned(name) ?? cleaned(email.split("@")[0] ?? "") ?? "member";
  const taken = ctx.sqlite.prepare<{ id: number }, [string]>(
    "SELECT id FROM users WHERE username_key = ?1 UNION ALL SELECT id FROM auth_user WHERE username = ?1",
  );
  const free = (value: string) => !taken.get(value.toLowerCase());
  if (free(base)) return base;
  for (let n = 2; n < NUMBERED_TRIES + 2; n++) {
    const suffix = String(n);
    const value = `${base.slice(0, USERNAME_MAX_LENGTH - suffix.length)}${suffix}`;
    if (isValidUsername(value) && free(value)) return value;
  }
  const suffix = String(Math.floor(Math.random() * 1e9));
  return `${base.slice(0, USERNAME_MAX_LENGTH - suffix.length)}${suffix}`;
}
