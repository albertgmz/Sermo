import * as z from "zod";
import {
  AUTO_WATCH_MODES,
  FEED_VIEWS,
  HOME_TABS,
  NODE_WATCH_MODES,
  PROFILE_POST_PRIVACY,
  PROFILE_VIEW_PRIVACY,
  THEMES,
} from "../db/schema";
import { defineContract } from "../operation";
import { Id, Ok, Page, pageInput, Timestamp, UserSummary } from "./common";

export { FEED_VIEWS };

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

export const MemberRelation = z
  .object({
    userId: Id,
    /** The viewer follows this member. */
    following: z.boolean(),
    /** The viewer may start following this member (member.follow, and not themselves). */
    canFollow: z.boolean(),
    /** The viewer may start a conversation with this member. */
    canMessage: z.boolean(),
    /** The viewer blocks this member. */
    blocking: z.boolean(),
    /** The viewer may block this member (member.block, and not themselves); unblocking needs no permission. */
    canBlock: z.boolean(),
  })
  .meta({ id: "MemberRelation" });

export const usersRelations = defineContract({
  name: "users.relations",
  summary:
    "What the viewer can do about up to 50 members, in one call and in no particular order: " +
    "whether they follow each one, may start following them (member.follow, not themselves, no " +
    "block between them; unfollowing needs no permission) and may start a conversation with them " +
    "(conversation.start, a conversation.maxRecipients other than 0, not themselves, no block " +
    "between them unless the viewer holds conversation.alwaysInvite, and the member holds " +
    "conversation.receive), and whether they block each one and may block them (member.block, " +
    "not themselves; unblocking needs no permission). Unknown ids are left out, and so are members " +
    "whose block hides them from the viewer (a viewer with moderation.access or " +
    "conversation.alwaysInvite still gets them). Open to everyone; a guest gets false for all " +
    "five. The viewer's own follow and block lists are theirs to read. It does not depend on " +
    "profile privacy.",
  kind: "read",
  input: z.object({ userIds: z.array(Id).min(1).max(50) }),
  output: z.object({ items: z.array(MemberRelation) }),
});

export const usersListFollowers = defineContract({
  name: "users.listFollowers",
  summary: "Members following a member, newest first. Requires site.view and profile.view.",
  kind: "read",
  input: z.object({ userId: Id, ...pageInput }),
  output: Page(FollowEntry),
});

export const usersListFollowing = defineContract({
  name: "users.listFollowing",
  summary:
    "Members a member follows, newest first. Requires site.view and profile.view, and member.viewFollowing for anyone but the member.",
  kind: "read",
  input: z.object({ userId: Id, ...pageInput }),
  output: Page(FollowEntry),
});

// Blocking -------------------------------------------------------------------------------------

export const usersBlock = defineContract({
  name: "users.block",
  summary:
    "Block a member. Neither of you sees the other anywhere (content, profile, lists, search, " +
    "notifications); staff blocked by a member still see and act on everything of that member. " +
    "Neither can follow, react to, mention-notify, post on the profile of or start a " +
    "conversation with the other, and follows between you end. The private conversations only " +
    "you two share disappear for both of you (staff blocked by the member keep theirs) and are " +
    "deleted 90 days later; in group conversations each of you stops seeing the messages the " +
    "other sends from now on. The member is not told. Requires member.block; you cannot block " +
    "yourself.",
  kind: "write",
  input: z.object({ userId: Id }),
  output: Ok,
});

export const usersUnblock = defineContract({
  name: "users.unblock",
  summary:
    "Stop blocking a member. Their public content shows again; the conversations and messages " +
    "the block hid stay hidden.",
  kind: "write",
  input: z.object({ userId: Id }),
  output: Ok,
});

export const usersListBlocked = defineContract({
  name: "users.listBlocked",
  summary: "Members you block, newest first. Only your own list.",
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
    /** Whether the keyboard shortcuts of the web interface are on. */
    keyboardShortcuts: z.boolean(),
    /** The tab of the feed page (What's new) you open on; null follows the site default. */
    homeTab: z.enum(HOME_TABS).nullable(),
    /** How the feed is drawn for you: full cards or compact rows. */
    feedView: z.enum(FEED_VIEWS),
    /** Your colour theme (system follows the device); null follows the browser's own choice. */
    theme: z.enum(THEMES).nullable(),
    /**
     * Whether others see your online status: off leaves you out of users.recentlyActive and
     * hides your last activity on your profile (staff with profile.bypassPrivacy still see it).
     */
    showOnline: z.boolean(),
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
