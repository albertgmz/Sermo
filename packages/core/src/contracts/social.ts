import * as z from "zod";
import {
  AUTO_WATCH_MODES,
  NODE_WATCH_MODES,
  PROFILE_POST_PRIVACY,
  PROFILE_VIEW_PRIVACY,
} from "../db/schema";
import { defineContract } from "../operation";
import { Id, Ok, Page, pageInput, Timestamp, UserSummary } from "./common";

// Watching -------------------------------------------------------------------------------------

export const ThreadWatch = z
  .object({
    threadId: Id,
    title: z.string(),
    nodeId: Id,
    /** Also send email for this watch (the email channel must be enabled for the type). */
    email: z.boolean(),
    lastPostAt: Timestamp,
    createdAt: Timestamp,
  })
  .meta({ id: "ThreadWatch" });

export const NodeWatch = z
  .object({
    nodeId: Id,
    title: z.string(),
    /** `threads`: new threads only; `posts`: every new post. */
    mode: z.enum(NODE_WATCH_MODES),
    email: z.boolean(),
    createdAt: Timestamp,
  })
  .meta({ id: "NodeWatch" });

export const threadsWatch = defineContract({
  name: "threads.watch",
  summary: "Watch a thread you can see (or change its email setting). Signed-in members.",
  kind: "write",
  input: z.object({ threadId: Id, email: z.boolean().default(false) }),
  output: z.object({ watching: z.literal(true), email: z.boolean() }),
});

export const threadsUnwatch = defineContract({
  name: "threads.unwatch",
  summary: "Stop watching a thread. Signed-in members.",
  kind: "write",
  input: z.object({ threadId: Id }),
  output: Ok,
});

export const nodesWatch = defineContract({
  name: "nodes.watch",
  summary:
    "Watch a forum you can see for new threads only or for every new post (or change the mode " +
    "or email setting). Signed-in members.",
  kind: "write",
  input: z.object({
    nodeId: Id,
    mode: z.enum(NODE_WATCH_MODES).default("threads"),
    email: z.boolean().default(false),
  }),
  output: z.object({
    watching: z.literal(true),
    mode: z.enum(NODE_WATCH_MODES),
    email: z.boolean(),
  }),
});

export const nodesUnwatch = defineContract({
  name: "nodes.unwatch",
  summary: "Stop watching a forum. Signed-in members.",
  kind: "write",
  input: z.object({ nodeId: Id }),
  output: Ok,
});

export const watchesListThreads = defineContract({
  name: "watches.listThreads",
  summary: "Threads you watch (that you can still see), most recently watched first.",
  kind: "read",
  input: z.object(pageInput),
  output: Page(ThreadWatch),
});

export const watchesListNodes = defineContract({
  name: "watches.listNodes",
  summary: "Forums you watch (that you can still see), most recently watched first.",
  kind: "read",
  input: z.object(pageInput),
  output: Page(NodeWatch),
});

// Following ------------------------------------------------------------------------------------

export const FollowEntry = z
  .object({ user: UserSummary, followedAt: Timestamp })
  .meta({ id: "FollowEntry" });

export const usersFollow = defineContract({
  name: "users.follow",
  summary: "Follow a member. Requires member.follow; you cannot follow yourself.",
  kind: "write",
  input: z.object({ userId: Id }),
  output: z.object({ following: z.literal(true), followerCount: z.number().int() }),
});

export const usersUnfollow = defineContract({
  name: "users.unfollow",
  summary: "Stop following a member.",
  kind: "write",
  input: z.object({ userId: Id }),
  output: Ok,
});

export const usersListFollowers = defineContract({
  name: "users.listFollowers",
  summary: "Members following a member, newest first. Requires profile.view.",
  kind: "read",
  input: z.object({ userId: Id, ...pageInput }),
  output: Page(FollowEntry),
});

export const usersListFollowing = defineContract({
  name: "users.listFollowing",
  summary: "Members a member follows, newest first. Requires profile.view.",
  kind: "read",
  input: z.object({ userId: Id, ...pageInput }),
  output: Page(FollowEntry),
});

// Ignoring -------------------------------------------------------------------------------------

export const usersIgnore = defineContract({
  name: "users.ignore",
  summary:
    "Ignore a member: they cannot notify you, start a conversation with you, or post on your " +
    "profile. Requires member.ignore; refused (Forbidden) when the member lacks " +
    "member.ignorable (staff by default). You cannot ignore yourself.",
  kind: "write",
  input: z.object({ userId: Id }),
  output: Ok,
});

export const usersUnignore = defineContract({
  name: "users.unignore",
  summary: "Stop ignoring a member.",
  kind: "write",
  input: z.object({ userId: Id }),
  output: Ok,
});

export const usersListIgnored = defineContract({
  name: "users.listIgnored",
  summary: "Members you ignore, newest first. Only your own list.",
  kind: "read",
  input: z.object(pageInput),
  output: Page(FollowEntry),
});

// Preferences ----------------------------------------------------------------------------------

export const MemberPreferences = z
  .object({
    /** Watch threads you start / reply to automatically, optionally with email. */
    watchOnCreate: z.enum(AUTO_WATCH_MODES),
    watchOnReply: z.enum(AUTO_WATCH_MODES),
    /** BCP 47 tag of a supported language; null follows the site default. */
    language: z.string().nullable(),
    /** Who can view your profile: everyone, members, members you follow, only you. */
    profileViewPrivacy: z.enum(PROFILE_VIEW_PRIVACY),
    /** Who can post on your profile: members, members you follow, only you. */
    profilePostPrivacy: z.enum(PROFILE_POST_PRIVACY),
  })
  .meta({ id: "MemberPreferences" });

export const preferencesGet = defineContract({
  name: "preferences.get",
  summary: "Your preferences. Signed-in members.",
  kind: "read",
  input: z.object({}),
  output: MemberPreferences,
});

export const preferencesUpdate = defineContract({
  name: "preferences.update",
  summary: "Change your preferences. Signed-in members; the language must be supported.",
  kind: "write",
  input: MemberPreferences.partial(),
  output: MemberPreferences,
});
