/**
 * Better Auth options that shape the database schema. Shared by the runtime auth instance
 * (modules/auth) and the schema generator config (auth.config.ts), so the generated tables always
 * match what runs. Runtime-only options (secret, URLs, hooks, rate limits) live in modules/auth,
 * except the address of Better Auth's error page below, which is the same for every site.
 */
import { apiKey } from "@better-auth/api-key";
import type { BetterAuthOptions } from "better-auth";
import { username } from "better-auth/plugins";

/** Same rule as before the switch: letters, numbers, spaces, '.', '-', '_'; ends alphanumeric. */
export const USERNAME_PATTERN = /^[\p{L}\p{N}_](?:[\p{L}\p{N}_.\- ]*[\p{L}\p{N}_])?$/u;
export const API_KEY_PREFIX = "sermo_";
export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 32;
/** Sign-in looks any name up, so only a limit that keeps absurd input out of the lookup. */
const SIGN_IN_MAX_LENGTH = 100;

/**
 * Why a new username (a registration or a rename) is refused, as the Better Auth error code, or
 * null when it is fine. It must also obey the pattern after lowercasing ("İ" adds a
 * combining dot). Only new names meet this rule: sign-in and display take any name an imported
 * account brought (see `users.imported`).
 */
export function usernameRefusal(
  value: string,
): "USERNAME_TOO_SHORT" | "USERNAME_TOO_LONG" | "INVALID_USERNAME" | null {
  if (value.length < USERNAME_MIN_LENGTH) return "USERNAME_TOO_SHORT";
  if (value.length > USERNAME_MAX_LENGTH) return "USERNAME_TOO_LONG";
  return USERNAME_PATTERN.test(value) && USERNAME_PATTERN.test(value.toLowerCase())
    ? null
    : "INVALID_USERNAME";
}

export function isValidUsername(value: string): boolean {
  return usernameRefusal(value) === null;
}

/**
 * Names that begin with "deleted member" (in any letter case, after the lowercasing the
 * uniqueness key uses) are kept for erased accounts, which are renamed `Deleted member <id>`.
 * Nobody can register or rename to one, so an erasure never meets a name taken in advance.
 */
export function isReservedUsername(value: string): boolean {
  return value.toLowerCase().startsWith("deleted member");
}

export function authPlugins() {
  return [
    username({
      // The plugin applies these to sign-in too, where an imported account's name may be any
      // name. The registration rule is enforced by the auth module's hooks (`usernameRefusal`).
      minUsernameLength: 1,
      maxUsernameLength: SIGN_IN_MAX_LENGTH,
      usernameValidator: () => true,
      // The display form becomes the forum identity (users.username). The auth module's database
      // hooks hold it to the same rule, and to the username apart from letter case.
    }),
    apiKey({
      schema: { apikey: { modelName: "auth_apikey" } },
      defaultPrefix: API_KEY_PREFIX,
      // Keys are verified read-only by resolveActor (the plugin's own check writes on every
      // request), so the plugin only creates, lists and deletes keys.
      enableSessionForAPIKeys: false,
      rateLimit: { enabled: false },
    }),
  ];
}

/**
 * Where Better Auth sends a browser whose sign-in failed before it knew where to send it back (a
 * provider return without its state, a state that expired or whose cookie the browser did not keep,
 * a malformed callback), and the visitors of its own error page: the web app's sign-in page, which
 * tells each `?error=<code>` in the visitor's language. Root-relative: the API is served on the
 * site's own address.
 */
export const AUTH_ERROR_URL = "/login";

export const authSchemaOptions = {
  onAPIError: { errorURL: AUTH_ERROR_URL },
  user: { modelName: "auth_user" },
  session: { modelName: "auth_session" },
  account: { modelName: "auth_account" },
  verification: { modelName: "auth_verification" },
  advanced: { database: { generateId: "serial" } },
} satisfies Partial<BetterAuthOptions>;
