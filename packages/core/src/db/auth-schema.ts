/**
 * Better Auth's tables (identity, credentials, sessions, API keys). Kept in sync with
 * auth-options.ts by running the command in auth.config.ts; do not edit by hand.
 * Forum data about users lives in Sermo's own `users` table, keyed by auth_user.id.
 */
import { relations } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const auth_user = sqliteTable("auth_user", {
  id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" }).default(false).notNull(),
  image: text("image"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .$onUpdate(() => new Date())
    .notNull(),
  username: text("username").unique(),
  displayUsername: text("display_username"),
});

export const auth_session = sqliteTable(
  "auth_session",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .$onUpdate(() => new Date())
      .notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: integer("user_id")
      .notNull()
      .references(() => auth_user.id, { onDelete: "cascade" }),
  },
  (table) => [index("auth_session_userId_idx").on(table.userId)],
);

export const auth_account = sqliteTable(
  "auth_account",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: integer("user_id")
      .notNull()
      .references(() => auth_user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: integer("access_token_expires_at", {
      mode: "timestamp_ms",
    }),
    refreshTokenExpiresAt: integer("refresh_token_expires_at", {
      mode: "timestamp_ms",
    }),
    scope: text("scope"),
    password: text("password"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("auth_account_userId_idx").on(table.userId)],
);

export const auth_verification = sqliteTable(
  "auth_verification",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("auth_verification_identifier_idx").on(table.identifier)],
);

export const auth_apikey = sqliteTable(
  "auth_apikey",
  {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    configId: text("config_id").default("default").notNull(),
    name: text("name"),
    start: text("start"),
    referenceId: text("reference_id").notNull(),
    prefix: text("prefix"),
    key: text("key").notNull(),
    refillInterval: integer("refill_interval"),
    refillAmount: integer("refill_amount"),
    lastRefillAt: integer("last_refill_at", { mode: "timestamp_ms" }),
    enabled: integer("enabled", { mode: "boolean" }).default(true),
    rateLimitEnabled: integer("rate_limit_enabled", {
      mode: "boolean",
    }).default(true),
    rateLimitTimeWindow: integer("rate_limit_time_window").default(86400000),
    rateLimitMax: integer("rate_limit_max").default(10),
    requestCount: integer("request_count").default(0),
    remaining: integer("remaining"),
    lastRequest: integer("last_request", { mode: "timestamp_ms" }),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
    permissions: text("permissions"),
    metadata: text("metadata"),
  },
  (table) => [
    index("auth_apikey_configId_idx").on(table.configId),
    index("auth_apikey_referenceId_idx").on(table.referenceId),
    index("auth_apikey_key_idx").on(table.key),
  ],
);

export const auth_userRelations = relations(auth_user, ({ many }) => ({
  auth_sessions: many(auth_session),
  auth_accounts: many(auth_account),
}));

export const auth_sessionRelations = relations(auth_session, ({ one }) => ({
  auth_user: one(auth_user, {
    fields: [auth_session.userId],
    references: [auth_user.id],
  }),
}));

export const auth_accountRelations = relations(auth_account, ({ one }) => ({
  auth_user: one(auth_user, {
    fields: [auth_account.userId],
    references: [auth_user.id],
  }),
}));
