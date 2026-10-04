import * as z from "zod";
import { defineContract } from "../operation";
import { Empty, Id, Ok, Timestamp } from "./common";

export const Username = z
  .string()
  .trim()
  .min(3)
  .max(32)
  .regex(/^[\p{L}\p{N}_](?:[\p{L}\p{N}_.\- ]*[\p{L}\p{N}_])?$/u, {
    error: "Use letters, numbers, spaces, '.', '-' or '_'; start and end with a letter or number.",
  });
export const Password = z.string().min(8).max(256);
export const Email = z.email().max(254);

/** Group-level permissions of the current actor (guests get the guest group's). */
export const GlobalPermissions = z
  .object({
    isAdmin: z.boolean(),
    isModerator: z.boolean(),
    canViewProfiles: z.boolean(),
    canPostProfile: z.boolean(),
    canStartConversations: z.boolean(),
    canReact: z.boolean(),
  })
  .meta({ id: "GlobalPermissions" });

export const SelfUser = z
  .object({
    id: Id,
    username: z.string(),
    email: z.string(),
    groupId: Id,
    createdAt: Timestamp,
  })
  .meta({ id: "SelfUser" });

export const Session = z.object({
  /** Plaintext session token; returned once. REST sets it as an HttpOnly cookie. */
  token: z.string(),
  expiresAt: Timestamp,
});

export const ApiToken = z
  .object({ id: Id, name: z.string(), createdAt: Timestamp, expiresAt: Timestamp.nullable() })
  .meta({ id: "ApiToken" });

const AuthResult = z.object({ user: SelfUser, session: Session });

export const authRegister = defineContract({
  name: "auth.register",
  summary: "Create an account and start a session. Guests only.",
  kind: "write",
  input: z.object({ username: Username, email: Email, password: Password }),
  output: AuthResult,
});

export const authLogin = defineContract({
  name: "auth.login",
  summary: "Sign in with username or email and password; starts a session.",
  kind: "write",
  input: z.object({
    login: z.string().trim().min(1).max(254),
    password: z.string().min(1).max(256),
  }),
  output: AuthResult,
});

export const authLogout = defineContract({
  name: "auth.logout",
  summary: "End the current session. Requires a session actor.",
  kind: "write",
  input: Empty,
  output: Ok,
});

export const authMe = defineContract({
  name: "auth.me",
  summary: "The current user (null for guests) and their group-level permissions.",
  kind: "read",
  input: Empty,
  output: z.object({ user: SelfUser.nullable(), permissions: GlobalPermissions }),
});

export const authCreateToken = defineContract({
  name: "auth.createToken",
  summary: "Create an API token for the current user. Requires a session actor.",
  kind: "write",
  input: z.object({
    name: z.string().trim().min(1).max(100),
    expiresInDays: z.number().int().min(1).max(3650).optional(),
  }),
  output: z.object({
    /** Plaintext token; shown once, never retrievable again. */
    token: z.string(),
    apiToken: ApiToken,
  }),
});

export const authListTokens = defineContract({
  name: "auth.listTokens",
  summary: "List the current user's API tokens. Requires a session actor.",
  kind: "read",
  input: Empty,
  output: z.object({ items: z.array(ApiToken) }),
});

export const authRevokeToken = defineContract({
  name: "auth.revokeToken",
  summary: "Revoke one of the current user's API tokens. Requires a session actor.",
  kind: "write",
  input: z.object({ tokenId: Id }),
  output: Ok,
});
