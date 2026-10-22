import * as z from "zod";
import { FEED_VIEWS, HOME_TABS, THEMES } from "../db/schema";
import { defineContract } from "../operation";
import { DisplayGroup, Empty, Id, ResolvedPermissions, Timestamp } from "./common";
import { PendingAcceptance } from "./terms";

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
    /** The viewer may post on their own profile wall (profilePost.postOwn). */
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
    /** The interface language the member chose (a code of `SUPPORTED_LANGUAGES`); null when they made no choice. */
    language: z.string().nullable(),
    /** Whether the member keeps the web interface's keyboard shortcuts on (their preference). */
    keyboardShortcuts: z.boolean(),
    /** The tab of the feed page (What's new) the member chose; null when they made no choice (the site default applies). */
    homeTab: z.enum(HOME_TABS).nullable(),
    /** How the member wants the feed drawn: full cards or compact rows. */
    feedView: z.enum(FEED_VIEWS),
    /** The colour theme the member chose (system follows the device); null when they made no choice (the browser's own applies). */
    theme: z.enum(THEMES).nullable(),
    /**
     * The tab the feed page (What's new) opens on for this member when the address names none: their choice
     * (`homeTab`), else the site's home tab rules decided for them, else the site's fallback.
     */
    openHomeTab: z.enum(HOME_TABS),
    /**
     * The published terms and rules pages the member has not accepted at their current version
     * (empty when nothing is pending). While it is not empty, posting, reacting and messaging
     * are refused with a `forbidden` error whose issue path is `acceptance`; `terms.accept`
     * accepts what is listed here.
     */
    pendingAcceptance: z.array(PendingAcceptance),
    /**
     * The account waits for staff to approve it (the site approves new accounts by hand and this
     * one has confirmed its email). It reads as a guest and takes no write until staff decide;
     * those refusals are `forbidden` errors whose issue path is `approval`.
     */
    awaitingApproval: z.boolean(),
    /**
     * The id of the session this request came from, or null for an API key. Not a secret and never
     * reused: a browser compares it with the one it stored to tell that the member signed in again
     * since it last saved a push device (`push.subscribe` links a device to its session).
     */
    sessionId: Id.nullable(),
  })
  .meta({ id: "SelfUser" });

/**
 * What this viewer can act on in a queue, found within a bounded scan. `count` never exceeds
 * `cap`. `more` is true when the scan stopped at its bound (the newest 100 entries of the
 * queue, whoever they belong to) so `count` may be incomplete: it is not "this viewer has more
 * than `count`". Show "`count` or more" when `more` is true; `count` itself when it is false.
 */
export const QueueCount = z
  .object({
    count: z.number().int().min(0).max(99),
    more: z.boolean(),
    /** The largest `count` this read can report. */
    cap: z.number().int().positive(),
  })
  .meta({ id: "QueueCount" });

export const authCounters = defineContract({
  name: "auth.counters",
  summary:
    "What the signed-in member has not seen yet: unread notifications, and unread " +
    "conversations among their 100 most recently active ones (so at most 100). Zeros for guests. " +
    "For staff who may open the queues, `openReports`, `pendingApprovals` and `pendingSignups` (accounts " +
    "waiting for approval, for those who hold member.approveRegistrations) count what they " +
    "may act on among the newest 100 entries of each queue (at most `cap`, 99), and `more` says " +
    "the scan stopped at that bound, so `count` may be incomplete (a moderator of one forum on " +
    "a busy site can get a small `count` with `more` true: the 100 entries were not all " +
    "theirs). A client shows `count` when `more` is false and `count` or more when it is " +
    "true; everyone else gets zero, false and the `cap`, at no cost.",
  kind: "read",
  input: Empty,
  output: z.object({
    notifications: z.number().int().nonnegative(),
    conversations: z.number().int().nonnegative(),
    openReports: QueueCount,
    pendingApprovals: QueueCount,
    pendingSignups: QueueCount,
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
