/**
 * Better Auth options that shape the database schema. Shared by the runtime auth instance
 * (modules/auth) and the schema generator config (auth.config.ts), so the generated tables always
 * match what runs. Runtime-only options (secret, URLs, hooks, rate limits) live in modules/auth.
 */
import { apiKey } from "@better-auth/api-key";
import type { BetterAuthOptions } from "better-auth";
import { username } from "better-auth/plugins";

/** Same rule as before the switch: letters, numbers, spaces, '.', '-', '_'; ends alphanumeric. */
export const USERNAME_PATTERN = /^[\p{L}\p{N}_](?:[\p{L}\p{N}_.\- ]*[\p{L}\p{N}_])?$/u;
export const API_KEY_PREFIX = "sermo_";

export function authPlugins() {
  return [
    username({
      minUsernameLength: 3,
      maxUsernameLength: 32,
      usernameValidator: (value) => USERNAME_PATTERN.test(value),
      // The display form becomes the forum identity (users.username), so it obeys the same rule.
      // The auth module also requires it to equal the username apart from letter case.
      displayUsernameValidator: (value) => USERNAME_PATTERN.test(value),
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

export const authSchemaOptions = {
  user: { modelName: "auth_user" },
  session: { modelName: "auth_session" },
  account: { modelName: "auth_account" },
  verification: { modelName: "auth_verification" },
  advanced: { database: { generateId: "serial" } },
} satisfies Partial<BetterAuthOptions>;
