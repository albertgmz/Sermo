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

export const authCounters = defineContract({
  name: "auth.counters",
  summary:
    "What the signed-in member has not seen yet: unread notifications, and unread " +
    "conversations among their 100 most recently active ones (so at most 100). Zeros for guests.",
  kind: "read",
  input: Empty,
  output: z.object({
    notifications: z.number().int().nonnegative(),
    conversations: z.number().int().nonnegative(),
  }),
});

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
    /**
     * What a staff interface needs beyond the global permissions above, which do not show a
     * member who moderates only some forums. `moderatesEverywhere`: holds at least one moderation
     * permission of scope `node` globally. `moderatedNodeIds`: otherwise, the forums where a
     * node entry grants them one (at most 500; `moderatedNodesTruncated` is true when there are
     * more). `panel`: holds any permission of the `admin` or `moderation` categories anywhere
     * that lets them act on others, so there is something for them in a staff interface (a
     * permission that only exempts the member, such as member.immuneToAutoBan, does not count).
     */
    staff: z.object({
      panel: z.boolean(),
      moderatesEverywhere: z.boolean(),
      moderatedNodeIds: z.array(Id),
      moderatedNodesTruncated: z.boolean(),
    }),
  }),
});
