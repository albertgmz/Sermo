import * as z from "zod";
import { defineContract } from "../operation";
import { Empty, Id, Ok } from "./common";

export const Group = z
  .object({
    id: Id,
    title: z.string(),
    isAdmin: z.boolean(),
    isModerator: z.boolean(),
    canViewNodes: z.boolean(),
    canPost: z.boolean(),
    canViewProfiles: z.boolean(),
    canPostProfile: z.boolean(),
    canStartConversations: z.boolean(),
    canReact: z.boolean(),
  })
  .meta({ id: "Group" });

/** A per-node override for one group. Null means "inherit". */
export const NodePermissionEntry = z
  .object({
    nodeId: Id,
    groupId: Id,
    canView: z.boolean().nullable(),
    canPost: z.boolean().nullable(),
    canModerate: z.boolean().nullable(),
  })
  .meta({ id: "NodePermissionEntry" });

export const groupsList = defineContract({
  name: "groups.list",
  summary: "List all groups with their permissions. Admins only.",
  kind: "read",
  input: Empty,
  output: z.object({ items: z.array(Group) }),
});

export const groupsUpdate = defineContract({
  name: "groups.update",
  summary: "Change a group's title or group-level permissions. Admins only.",
  kind: "write",
  input: z.object({
    groupId: Id,
    title: z.string().trim().min(1).max(50).optional(),
    isAdmin: z.boolean().optional(),
    isModerator: z.boolean().optional(),
    canViewNodes: z.boolean().optional(),
    canPost: z.boolean().optional(),
    canViewProfiles: z.boolean().optional(),
    canPostProfile: z.boolean().optional(),
    canStartConversations: z.boolean().optional(),
    canReact: z.boolean().optional(),
  }),
  output: Group,
});

export const usersSetGroup = defineContract({
  name: "users.setGroup",
  summary: "Move a user to another group. Admins only; the guest group cannot be assigned.",
  kind: "write",
  input: z.object({ userId: Id, groupId: Id }),
  output: Ok,
});

export const permissionsListNode = defineContract({
  name: "permissions.listNode",
  summary: "List the per-group permission overrides set on a node. Admins only.",
  kind: "read",
  input: z.object({ nodeId: Id }),
  output: z.object({ items: z.array(NodePermissionEntry) }),
});

export const permissionsSetNode = defineContract({
  name: "permissions.setNode",
  summary:
    "Set a group's view/post/moderate override on a node (null = inherit). Admins only. " +
    "Setting all three to null removes the override.",
  kind: "write",
  input: z.object({
    nodeId: Id,
    groupId: Id,
    canView: z.boolean().nullable(),
    canPost: z.boolean().nullable(),
    canModerate: z.boolean().nullable(),
  }),
  output: NodePermissionEntry,
});
