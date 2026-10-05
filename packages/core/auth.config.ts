/**
 * Config for Better Auth's schema generator only:
 *   cd packages/core && bun --bun x auth generate --config auth.config.ts --output src/db/auth-schema.ts --yes
 * The runtime instance is built in src/modules/auth from the same shared options.
 */
import { Database } from "bun:sqlite";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { authPlugins, authSchemaOptions } from "./src/db/auth-options";

export const auth = betterAuth({
  ...authSchemaOptions,
  secret: "schema-generation-only-secret-0123456789",
  database: drizzleAdapter(drizzle({ client: new Database(":memory:") }), { provider: "sqlite" }),
  emailAndPassword: { enabled: true },
  plugins: authPlugins(),
});
