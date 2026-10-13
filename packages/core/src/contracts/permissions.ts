import * as z from "zod";
import { BUILTIN_GROUPS } from "../db/schema";
import { defineContract } from "../operation";
import { ActorPassword, Empty, Id, Ok } from "./common";

const CONFIRM =
  " `actorPassword` is the acting administrator's own password: it is verified in the " +
  "same step and under the same wrong-answer limit as users.adminUpdateIdentity, and a wrong " +
  "one changes nothing. A browser session (session cookie) must send it (missing: a validation " +
  "error naming actorPassword); an API key or token is not asked and is refused if it sends one.";

// Groups -------------------------------------------------------------------------------------

export const Group = z
  .object({
    id: Id,
    title: z.string(),
    description: z.string(),
    /** Display and hierarchy only: which group a member displays, and who may act on whom. */
    rank: z.number().int(),
    /** Title shown under members who display this group; empty for none. */
    userTitle: z.string(),
    /** Style key of the badge members displaying this group show; empty for none. */
    badge: z.string(),
    /** Set on the built-in groups, which cannot be deleted. */
    builtin: z.enum(BUILTIN_GROUPS).nullable(),
    /** A colour of the `name` catalog: members show their name in it unless they chose one. */
    nameColorId: Id.nullable(),
    /** Its members are listed as staff (users.staff). */
    isStaff: z.boolean(),
    /** Members who have it as their primary group or by hand (not promotion or shop grants). */
    memberCount: z.number().int().nonnegative(),
  })
  .meta({ id: "Group" });

const GroupFields = {
  title: z.string().trim().min(1).max(50),
  description: z.string().trim().max(500),
  rank: z.number().int().min(0).max(1000),
  userTitle: z.string().trim().max(50),
  badge: z
    .string()
    .trim()
    .regex(/^[a-z0-9-]*$/)
    .max(30),
  /** An active colour of the `name` catalog, or null for none. */
  nameColorId: Id.nullable(),
  isStaff: z.boolean(),
};

export const groupsList = defineContract({
  name: "groups.list",
  summary:
    "List all groups, highest rank first, with their member counts. Requires any of " +
    "admin.groups, admin.permissions, admin.promotions or admin.members (the screens those open " +
    "need group names); the writes need admin.groups.",
  kind: "read",
  input: Empty,
  output: z.object({ items: z.array(Group) }),
});

export const groupsGet = defineContract({
  name: "groups.get",
  summary:
    "One group with its member count. Requires any of admin.groups, admin.permissions, " +
    "admin.promotions or admin.members.",
  kind: "read",
  input: z.object({ groupId: Id }),
  output: Group,
});

export const groupsCreate = defineContract({
  name: "groups.create",
  summary:
    "Create a group. It starts with no permission entries. Requires admin.groups; the rank must " +
    "be below the actor's own highest rank." +
    CONFIRM,
  kind: "write",
  input: z.object({
    title: GroupFields.title,
    description: GroupFields.description.default(""),
    rank: GroupFields.rank.default(10),
    userTitle: GroupFields.userTitle.default(""),
    badge: GroupFields.badge.default(""),
    nameColorId: GroupFields.nameColorId.default(null),
    isStaff: GroupFields.isStaff.default(false),
    actorPassword: ActorPassword.optional(),
  }),
  output: Group,
});

export const groupsUpdate = defineContract({
  name: "groups.update",
  summary:
    "Change a group's title, description, rank, user title or badge. Requires admin.groups; " +
    "groups ranked at or above the actor, and ranks at or above the actor's, are refused." +
    CONFIRM,
  kind: "write",
  input: z.object({
    groupId: Id,
    title: GroupFields.title.optional(),
    description: GroupFields.description.optional(),
    rank: GroupFields.rank.optional(),
    userTitle: GroupFields.userTitle.optional(),
    badge: GroupFields.badge.optional(),
    nameColorId: GroupFields.nameColorId.optional(),
    isStaff: GroupFields.isStaff.optional(),
    actorPassword: ActorPassword.optional(),
  }),
  output: Group,
});

export const groupsDelete = defineContract({
  name: "groups.delete",
  summary:
    "Delete a group that is not built in. Members whose primary group it was move to the " +
    "registered group; secondary memberships, promotion grants and the group's permission " +
    "entries are removed. Requires admin.groups." +
    CONFIRM,
  kind: "write",
  input: z.object({ groupId: Id, actorPassword: ActorPassword.optional() }),
  output: Ok,
});

// Membership ---------------------------------------------------------------------------------

export const MemberGroups = z
  .object({
    userId: Id,
    primaryGroupId: Id,
    /** Assigned by hand. */
    secondaryGroupIds: z.array(Id),
    /** Granted by promotions (managed by promotions, not by users.setGroups). */
    promotionGroupIds: z.array(Id),
    /** Held through shop items (managed by the shop, not by users.setGroups). */
    purchasedGroupIds: z.array(Id),
    /** The highest-ranked group, whose title and badge the member displays. */
    displayGroupId: Id.nullable(),
    /** Highest rank among all the member's groups. */
    rank: z.number().int(),
  })
  .meta({ id: "MemberGroups" });

export const usersGetGroups = defineContract({
  name: "users.getGroups",
  summary: "A member's primary, secondary and promotion groups. Requires admin.members.",
  kind: "read",
  input: z.object({ userId: Id }),
  output: MemberGroups,
});

export const usersSetGroups = defineContract({
  name: "users.setGroups",
  summary:
    "Set a member's primary group and/or their hand-assigned secondary groups (the full list). " +
    "Requires admin.members over the member (their highest rank must be below the actor's); " +
    "groups ranked at or above the actor cannot be given, the guest group cannot be assigned, " +
    "and the change is refused if no member would keep admin.permissions." +
    CONFIRM,
  kind: "write",
  input: z.object({
    userId: Id,
    primaryGroupId: Id.optional(),
    secondaryGroupIds: z.array(Id).max(50).optional(),
    actorPassword: ActorPassword.optional(),
  }),
  output: MemberGroups,
});

// Permissions --------------------------------------------------------------------------------

export const PermissionDefinitionSchema = z
  .object({
    id: z.string(),
    scope: z.enum(["global", "node"]),
    type: z.enum(["flag", "integer"]),
    category: z.string(),
    /** For integers: what the number counts. -1 means unlimited. */
    unit: z.enum(["bytes", "minutes", "count"]).nullable(),
    /** Phrase keys for the admin UI. */
    label: z.string(),
    description: z.string(),
    /** The label in the viewer's language; a readable form of the id when there is no phrase. */
    title: z.string(),
    /** The description in the viewer's language; empty when there is no phrase. */
    help: z.string(),
    /** The title of the category, in the viewer's language. */
    categoryTitle: z.string(),
    /** Built-in group key -> default applied when the permission first appeared. */
    defaults: z.record(z.string(), z.union([z.enum(["allow", "never"]), z.number().int()])),
    /** Conditions the check applies on top of the entries. */
    requiresAccount: z.boolean(),
    restriction: z.enum(["posting", "conversations", "profile_posts"]).nullable(),
    ownContentOnly: z.boolean(),
    /** Integer permission holding the time window (minutes) for this own-content permission. */
    timeLimit: z.string().nullable(),
    hierarchy: z.boolean(),
    threadBan: z.boolean(),
  })
  .meta({ id: "PermissionDefinition" });

/**
 * A yes/no value: `allow`, `never` (denies across all the member's groups), or on nodes `no`
 * (clears an inherited allow for this group only). Integers: the number, -1 for unlimited.
 */
export const PermissionValue = z
  .union([z.enum(["allow", "no", "never"]), z.number().int().min(-1)])
  .meta({ id: "PermissionValue" });

export const PermissionEntry = z
  .object({ permission: z.string(), value: PermissionValue })
  .meta({ id: "PermissionEntry" });

/** Exactly one of groupId / userId; nodeId absent or null for the global scope. */
const EntryTarget = {
  groupId: Id.optional(),
  userId: Id.optional(),
  nodeId: Id.nullable().optional(),
};

export const PermissionEntrySet = z
  .object({
    groupId: Id.nullable(),
    userId: Id.nullable(),
    nodeId: Id.nullable(),
    entries: z.array(PermissionEntry),
  })
  .meta({ id: "PermissionEntrySet" });

export const permissionsDefinitions = defineContract({
  name: "permissions.definitions",
  summary:
    "Every registered permission with its scope, type, defaults and conditions. Requires admin.permissions.",
  kind: "read",
  input: Empty,
  output: z.object({ items: z.array(PermissionDefinitionSchema) }),
});

export const permissionsList = defineContract({
  name: "permissions.list",
  summary:
    "The entries set for one group or one member at the global scope or on one node (unset " +
    "permissions are omitted). Requires admin.permissions.",
  kind: "read",
  input: z.object(EntryTarget),
  output: PermissionEntrySet,
});

export const permissionsSet = defineContract({
  name: "permissions.set",
  summary:
    "Set entries for one group or one member at the global scope or on one node; `unset` " +
    "removes an entry. `no` is only valid on nodes; global permissions only at the global " +
    "scope; the guest group never receives permissions that need an account. Refused if no " +
    "member would keep admin.permissions. Returns the target's entries at that scope. " +
    "Requires admin.permissions." +
    CONFIRM,
  kind: "write",
  input: z.object({
    ...EntryTarget,
    entries: z
      .array(
        z.object({ permission: z.string(), value: z.union([PermissionValue, z.literal("unset")]) }),
      )
      .min(1)
      .max(200),
    actorPassword: ActorPassword.optional(),
  }),
  output: PermissionEntrySet,
});

export const permissionsListNode = defineContract({
  name: "permissions.listNode",
  summary:
    "Every group and member entry set directly on a node (not inherited). Requires admin.permissions.",
  kind: "read",
  input: z.object({ nodeId: Id }),
  output: z.object({ items: z.array(PermissionEntrySet) }),
});

export const PermissionExplanation = z
  .object({
    permission: z.string(),
    scope: z.enum(["global", "node"]),
    nodeId: Id.nullable(),
    granted: z.boolean(),
    /** For integers, the resolved value. */
    value: z.number().int().nullable(),
    /** The rule that denied it before entries were consulted, if any. */
    deniedBy: z
      .enum([
        "banned",
        "account",
        "restricted",
        "threadBan",
        "notOwner",
        "notGranted",
        "timeLimit",
        "hierarchy",
        "viewRequired",
      ])
      .nullable(),
    /** One row per group of the member (and their member-specific entries): the deciding entry. */
    layers: z.array(
      z.object({
        kind: z.enum(["group", "member", "purchase"]),
        groupId: Id.nullable(),
        userId: Id.nullable(),
        title: z.string().nullable(),
        value: z.union([z.enum(["allow", "no", "never", "unset"]), z.number().int()]),
        /** Node the deciding entry is set on; 0 for the global scope; null when unset. */
        sourceNodeId: z.number().int().nonnegative().nullable(),
      }),
    ),
  })
  .meta({ id: "PermissionExplanation" });

export const permissionsExplain = defineContract({
  name: "permissions.explain",
  summary:
    "Whether a member (or a guest, with userId null) has a permission in a context, and which " +
    "group or member entry produced the result. Context fields the permission needs (node, " +
    "content owner and creation time, target member, thread ban) must be given. Requires " +
    "admin.permissions.",
  kind: "read",
  input: z.object({
    userId: Id.nullable(),
    permission: z.string(),
    nodeId: Id.optional(),
    ownerId: Id.optional(),
    createdAt: z.iso.datetime().optional(),
    targetUserId: Id.optional(),
    threadBanned: z.boolean().optional(),
  }),
  output: PermissionExplanation,
});
