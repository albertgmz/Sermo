import * as z from "zod";
import {
  NAVIGATION_AUDIENCES,
  NAVIGATION_ICON_POSITIONS,
  NAVIGATION_LOCATIONS,
} from "../db/schema";
import { defineContract } from "../operation";
import { Empty, IconKey, Id, Ok, Timestamp } from "./common";

/*
 * The links of the public site are data: the header, the bar at the bottom of a phone, the
 * account menu and the footer. An entry sits in one location, at the top level or under a
 * top-level entry of the same location (two levels, no deeper). Entries the site ships with are
 * built in: they can be renamed, reordered and switched off, never deleted or pointed
 * elsewhere. An administrator adds entries that link to a path of the site or to another site.
 */

export const NavigationLocation = z.enum(NAVIGATION_LOCATIONS);
export const NavigationAudience = z.enum(NAVIGATION_AUDIENCES);
export const NavigationIconPosition = z.enum(NAVIGATION_ICON_POSITIONS);

/** A path of this site (`/forums`, `/pages/rules`) or an absolute http(s) URL. */
export const NavigationTarget = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .refine(
    (value) =>
      // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are refused
      !/[\u0000-\u001f\u007f\u200b-\u200f\u2028-\u202e\ufeff]/.test(value) &&
      (/^\/(?!\/)[^\s\\]*$/.test(value) || /^https?:\/\/[^\s]+$/i.test(value)),
    "Use a path that starts with one slash, or an http(s) URL.",
  );

export const NavigationEntry = z
  .object({
    id: Id,
    location: NavigationLocation,
    /** The top-level entry this one sits under; null at the top level. */
    parentId: Id.nullable(),
    title: z.string(),
    /** Null on a heading that only groups its children (a footer column). */
    target: z.string().nullable(),
    position: z.number().int(),
    isEnabled: z.boolean(),
    /** Who sees it. `permission` shows it to holders of the global permission in `permission`. */
    audience: NavigationAudience,
    permission: z.string().nullable(),
    /** A key of the site's icon set drawn next to the title; null for none. */
    icon: IconKey.nullable(),
    /** Whether the icon sits before or after the title. */
    iconPosition: NavigationIconPosition,
    /** Set on the entries the site ships with: a stable key the client can attach behaviour to. */
    builtin: z.string().nullable(),
    createdAt: Timestamp,
    updatedAt: Timestamp,
  })
  .meta({ id: "NavigationEntry" });

/** What a visitor is shown: no administrative fields, children nested. */
export const NavigationLink = z
  .object({
    id: Id,
    title: z.string(),
    target: z.string().nullable(),
    builtin: z.string().nullable(),
    icon: IconKey.nullable(),
    iconPosition: NavigationIconPosition,
    children: z.array(
      z.object({
        id: Id,
        title: z.string(),
        target: z.string().nullable(),
        builtin: z.string().nullable(),
        icon: IconKey.nullable(),
        iconPosition: NavigationIconPosition,
      }),
    ),
  })
  .meta({ id: "NavigationLink" });

const Title = z.string().trim().min(1).max(60);
const Position = z.number().int().min(0).max(1_000_000);

export const navigationGet = defineContract({
  name: "navigation.get",
  summary:
    "The navigation the current visitor sees: per location, the enabled top-level entries in " +
    "display order (position, then id), each with its enabled children. An entry is left out " +
    "when its audience excludes the visitor; a child is left out with its parent; a heading " +
    "with no visible child is left out. Open to everyone.",
  kind: "read",
  input: Empty,
  output: z.object({
    header: z.array(NavigationLink),
    mobile: z.array(NavigationLink),
    account: z.array(NavigationLink),
    footer: z.array(NavigationLink),
  }),
});

export const navigationList = defineContract({
  name: "navigation.list",
  summary:
    "Every navigation entry, enabled or not, ordered by location, then parents before their " +
    "children, then position and id. Requires admin.settings.",
  kind: "read",
  input: Empty,
  output: z.object({ items: z.array(NavigationEntry) }),
});

export const navigationCreate = defineContract({
  name: "navigation.create",
  summary:
    "Add a navigation entry (at most 200 in all). A child's parent must be a top-level entry of " +
    "the same location. `icon` is a key of the site's icon set (null for none), drawn before or " +
    "after the title. `audience: permission` needs the id of a registered global permission " +
    "in `permission`; any other audience takes none. Requires admin.settings.",
  kind: "write",
  input: z.object({
    location: NavigationLocation,
    parentId: Id.nullable().default(null),
    title: Title,
    target: NavigationTarget.nullable(),
    position: Position.default(0),
    isEnabled: z.boolean().default(true),
    audience: NavigationAudience.default("everyone"),
    permission: z.string().trim().min(1).max(100).nullable().default(null),
    icon: IconKey.nullable().default(null),
    iconPosition: NavigationIconPosition.default("before"),
  }),
  output: NavigationEntry,
});

export const navigationUpdate = defineContract({
  name: "navigation.update",
  summary:
    "Change a navigation entry. A built-in entry keeps its location, parent and target: only " +
    "its title, icon, icon position, position, audience and whether it is enabled can change. An entry that has " +
    "children cannot be moved under another entry. Requires admin.settings.",
  kind: "write",
  input: z.object({
    entryId: Id,
    location: NavigationLocation.optional(),
    parentId: Id.nullable().optional(),
    title: Title.optional(),
    target: NavigationTarget.nullable().optional(),
    position: Position.optional(),
    isEnabled: z.boolean().optional(),
    audience: NavigationAudience.optional(),
    permission: z.string().trim().min(1).max(100).nullable().optional(),
    icon: IconKey.nullable().optional(),
    iconPosition: NavigationIconPosition.optional(),
  }),
  output: NavigationEntry,
});

export const navigationDelete = defineContract({
  name: "navigation.delete",
  summary:
    "Delete a navigation entry an administrator created, together with its children. A " +
    "built-in entry cannot be deleted (a conflict): disable it instead. Requires admin.settings.",
  kind: "write",
  input: z.object({ entryId: Id }),
  output: Ok,
});
