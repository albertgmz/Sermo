import * as z from "zod";
import { defineContract } from "../operation";
import { DisplayGroup, Empty, Id, ResolvedPermissions, Timestamp } from "./common";

/*
 * Registration, sign-in, sign-out, sessions and API keys are served by Better Auth's own
 * endpoints (mounted by the HTTP adapter under /api/auth). Only `auth.me` is a Sermo operation.
 */

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
    displayGroup: DisplayGroup.nullable(),
  })
  .meta({ id: "SelfUser" });

export const authMe = defineContract({
  name: "auth.me",
  summary:
    "The current user (null for guests), a summary of their permissions, and every global " +
    "permission resolved for them.",
  kind: "read",
  input: Empty,
  output: z.object({
    user: SelfUser.nullable(),
    permissions: GlobalPermissions,
    resolvedPermissions: ResolvedPermissions,
  }),
});
