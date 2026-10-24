import * as z from "zod";
import { AWARD_TIERS } from "../db/schema";
import { defineContract } from "../operation";
import { FramePlacement } from "./appearance";
import { Empty, IconKey, Id, Page, pageInput, Timestamp } from "./common";
import { ImageReference } from "./images";

/*
 * How a member looks wherever their name or picture appears, and the lists of members. Posts,
 * threads and every other listing keep carrying the small `UserSummary` (id and username); a
 * page collects the ids it shows and asks for their cards once with `users.cards`.
 */

/** Everything needed to draw a member next to their name. Nothing here is private. */
export const MemberCard = z
  .object({
    id: Id,
    username: z.string(),
    /** The avatar and a 128 px rendition for lists; null draws the initials. */
    avatar: z.object({ url: z.string(), smallUrl: z.string() }).nullable(),
    /** The avatar frame the member wears, with where it sits around the avatar. */
    frame: z.object({ url: z.string(), placement: FramePlacement }).nullable(),
    /** #rrggbb: the colour the member chose, else the colour of their highest group that has one. */
    nameColor: z.string().nullable(),
    /** The icon the member wears beside their name, and on which side; null on a minimal card. */
    nameIcon: z.object({ icon: IconKey, position: z.enum(["before", "after"]) }).nullable(),
    /**
     * The title under the name: the member's custom title while they may show one, else the
     * user title of their display group, else the title of their level.
     */
    title: z.string(),
    /**
     * One badge per group of the member that shows a badge, highest rank first: the group's
     * title, its colour (or null), and its badge style key, which the client maps to a look.
     */
    badges: z.array(
      z.object({ label: z.string(), color: z.string().nullable(), style: z.string() }),
    ),
    /** From the XP of the awards held and the site's level settings; 1 or more. */
    level: z.number().int().positive(),
    /**
     * True when the viewer may not open this member's profile: `users.cards` and `users.authors`
     * then answer a minimal card (id, username, avatar, frame, name colour and badges, no name icon; the title
     * is empty and the level 1). False everywhere else.
     */
    restricted: z.boolean(),
  })
  .meta({ id: "MemberCard" });

export const usersCards = defineContract({
  name: "users.cards",
  summary:
    "The cards of up to 100 members in one call, in no particular order. Unknown ids are left " +
    "out. Open to everyone: a card holds only what is shown next to a name wherever that " +
    "member's content is visible. For a member whose profile the viewer may not open " +
    "(their profile privacy, or the viewer lacks profile.view) the card is minimal and " +
    "`restricted` is true: title empty, level 1, no name icon.",
  kind: "read",
  input: z.object({ userIds: z.array(Id).min(1).max(100) }),
  output: z.object({ items: z.array(MemberCard) }),
});

/** A member as the author of content: the card plus what is drawn around a post. */
export const MemberAuthor = z
  .object({
    card: MemberCard,
    /** The profile cover: the chosen gallery cover, else the uploaded one, else null. */
    cover: ImageReference,
    createdAt: Timestamp,
    postCount: z.number().int().nonnegative(),
    reactionScore: z.number().int(),
    /** XP of the awards held and the bounds of the current level, for a progress bar. */
    awardXp: z.number().int().nonnegative(),
    currentLevelXp: z.number().int().nonnegative(),
    nextLevelXp: z.number().int().positive(),
    /**
     * The awards the member shows next to their name: the ones they hold, best tier first, then
     * highest XP, then lowest award id, cut to their profile.awardSlots.
     */
    awards: z.array(
      z.object({
        id: Id,
        name: z.string(),
        icon: z.string(),
        image: ImageReference,
        tier: z.enum(AWARD_TIERS),
      }),
    ),
    /** Rendered signature; null when there is none or the member may not show one. */
    signatureHtml: z.string().nullable(),
    /**
     * When the member was last active, to the minute. Null when they never were, for an erased
     * member, and when they hide their online status (`showOnline` off) from this viewer: the
     * member themself and holders of profile.bypassPrivacy still get it.
     */
    lastActivityAt: Timestamp.nullable(),
    /** True when `lastActivityAt` is given although the member hides their online status. */
    lastActivityHidden: z.boolean(),
  })
  .meta({ id: "MemberAuthor" });

export const usersAuthors = defineContract({
  name: "users.authors",
  summary:
    "Up to 50 members as authors, in one call and in no particular order: each one's card, " +
    "profile cover, counters, level bounds, the awards they show, their signature and when " +
    "they were last active. Unknown ids are left out. Open to everyone, like users.cards: it " +
    "holds only what is drawn around that member's content wherever the content is visible; " +
    "the last activity follows the member's online status privacy (null to others while " +
    "they hide it, given with `lastActivityHidden` to themselves and to holders of " +
    "profile.bypassPrivacy). For a member whose profile the " +
    "viewer may not open the card is the minimal one (`card.restricted` true) and the cover is " +
    "null, the join date is the epoch, the counters are zero, the next level bound is 1, the " +
    "awards are empty and the signature and last activity are null: a client shows only the card.",
  kind: "read",
  input: z.object({ userIds: z.array(Id).min(1).max(50) }),
  output: z.object({ items: z.array(MemberAuthor) }),
});

// The directory --------------------------------------------------------------------------------

export const MEMBER_SORTS = [
  "newest",
  "posts",
  "reactions",
  "level",
  "credits",
  "awards",
  "referrals",
] as const;

export const MemberListItem = z
  .object({
    card: MemberCard,
    createdAt: Timestamp,
    postCount: z.number().int().nonnegative(),
    reactionScore: z.number().int(),
    /** XP of the awards held; the level follows from it. */
    awardXp: z.number().int().nonnegative(),
    credits: z.number().int(),
    /** Awards currently held, counting each grant. */
    awardCount: z.number().int().nonnegative(),
    /** Members who named this member as their referrer. */
    referralCount: z.number().int().nonnegative(),
  })
  .meta({ id: "MemberListItem" });

export const usersList = defineContract({
  name: "users.list",
  summary:
    "The member directory, one sort at a time, highest first (`newest`: most recently " +
    "registered first; `level` sorts by award XP). Ties go to the older account. Banned members " +
    "and members whose profile the viewer may not open are left out, so a page can hold fewer " +
    "than `limit` items while `nextCursor` is non-null. With `ranked` the list is a ranking: " +
    "erased members and members whose figure for the sort is zero or less (not for " +
    "`newest`) are left out too, so a sort nobody has earned anything on is empty. Requires " +
    "profile.view and member.viewList.",
  kind: "read",
  input: z.object({
    sort: z.enum(MEMBER_SORTS).default("newest"),
    ranked: z.boolean().default(false),
    ...pageInput,
  }),
  output: Page(MemberListItem),
});

export const usersStaff = defineContract({
  name: "users.staff",
  summary:
    "The members of the groups marked as staff (at most 200), highest group rank first, then " +
    "by username, each with the titles of their staff groups. Banned members are left out. " +
    "Requires site.view, profile.view and member.viewList.",
  kind: "read",
  input: Empty,
  output: z.object({
    items: z.array(z.object({ card: MemberCard, groups: z.array(z.string()) })),
  }),
});

export const usersBirthdays = defineContract({
  name: "users.birthdays",
  summary:
    "The members whose birthday is today (UTC), whatever the year, at most 50, oldest account " +
    "first; on 28 February of a year without a 29th, those born on the 29th too. Banned members " +
    "and members whose profile the viewer may not open are left out. Requires site.view, profile.view and member.viewList.",
  kind: "read",
  input: Empty,
  output: z.object({ items: z.array(MemberCard) }),
});

export const usersRecentlyActive = defineContract({
  name: "users.recentlyActive",
  summary:
    "The members seen in the last 24 hours who show their online status, most recent first, at " +
    "most 200, with the total of members listed. Banned and erased members are left out. The " +
    "list is the same for every viewer and may be up to a minute old; a member whose profile " +
    "the viewer may not open has the minimal card (`card.restricted` true). Requires site.view, " +
    "profile.view and member.viewList.",
  kind: "read",
  input: Empty,
  output: z.object({
    /** Members seen in the last 24 hours who show their online status, banned and erased left out. */
    total: z.number().int().nonnegative(),
    /** The most recent first, at most 200; lastActivityAt to the minute. */
    items: z.array(z.object({ card: MemberCard, lastActivityAt: Timestamp })),
  }),
});

// Who is online, and where ------------------------------------------------------------------------

/**
 * The kinds of page a visitor can be on. `forum`, `thread` and `member` name one (a target);
 * `page` is any other page, and stands for a forum, thread or member the viewer may not see.
 */
export const PLACE_KINDS = [
  "forumList",
  "latest",
  "forum",
  "thread",
  "member",
  "members",
  "online",
  "conversations",
  "search",
  "page",
] as const;

/** The page a visitor last viewed, as the viewer may know it. */
export const ActivityPlace = z
  .object({
    kind: z.enum(PLACE_KINDS),
    /**
     * The forum, thread or member of a `forum`, `thread` or `member` place, with its title (the
     * member's name); null for the other kinds. A forum, thread or member the viewer may not see
     * is never named: the place is then `page`.
     */
    target: z.object({ id: Id, title: z.string() }).nullable(),
  })
  .meta({ id: "ActivityPlace" });

/** When a visitor was last seen and, within the last hour, where. */
export const VisitorActivity = z
  .object({
    /** The last request (a member) or page view (a guest), to the minute. */
    at: Timestamp,
    /** True for a member who hides their online status, shown to themselves and to staff. */
    hidden: z.boolean(),
    /** The page last viewed, when that was within the last hour; null otherwise. */
    place: ActivityPlace.nullable(),
  })
  .meta({ id: "VisitorActivity" });

export const usersActivity = defineContract({
  name: "users.activity",
  summary:
    "When each of up to 100 members was last active and, when they viewed a page in the last " +
    "hour, which, in one call and in no particular order. The rules of users.authors apply: a " +
    "member who hides their online status is left out except for themselves and holders of " +
    "profile.bypassPrivacy (who get `hidden` true), and so are members never seen, erased " +
    "members, unknown ids and members whose profile the viewer may not open. A forum, thread " +
    "or member profile is named only when the viewer may see it (a thread: visible, in a " +
    "forum they may view, and theirs or one they may open there); otherwise the place is " +
    "`page`. A conversation is never named.",
  kind: "read",
  input: z.object({ userIds: z.array(Id).min(1).max(100) }),
  output: z.object({ items: z.array(z.object({ userId: Id, activity: VisitorActivity })) }),
});

export const ONLINE_TYPES = ["all", "member", "guest", "robot"] as const;
export const ONLINE_PAGE_SIZE = 25;

export const OnlineVisitor = z
  .object({
    type: z.enum(["member", "guest", "robot"]),
    /** The member's card (minimal when the viewer may not open the profile); null otherwise. */
    card: MemberCard.nullable(),
    /** The robot's name and page, from the robot list; `name` is null for an unknown robot. */
    robot: z.object({ name: z.string().nullable(), url: z.string().nullable() }).nullable(),
    /** A guest's or robot's address, to holders of member.viewIps; null otherwise. */
    ip: z.string().nullable(),
    /** No place for a member whose profile the viewer may not open. */
    activity: VisitorActivity,
  })
  .meta({ id: "OnlineVisitor" });

export const onlineList = defineContract({
  name: "online.list",
  summary:
    "The current visitors, most recently seen first, 25 to a page: members seen " +
    "in the last 24 hours, and guests and robots that viewed a page in the last hour (robots " +
    "are told apart by their user agent). `type` keeps one kind. The place follows the rules " +
    "of users.activity. Members who hide their online status are left out except for " +
    "themselves and holders of profile.bypassPrivacy (`activity.hidden` true); banned and " +
    "erased members are left out. The list may be up to half a minute old. `total` counts the " +
    "visitors of the type for this viewer; a page past the last one is empty. Requires " +
    "site.view and member.viewList.",
  kind: "read",
  input: z.object({
    type: z.enum(ONLINE_TYPES).default("all"),
    page: z.number().int().min(1).max(10_000).default(1),
  }),
  output: z.object({
    items: z.array(OnlineVisitor),
    page: z.number().int().positive(),
    perPage: z.number().int().positive(),
    total: z.number().int().nonnegative(),
  }),
});

export const onlineCounts = defineContract({
  name: "online.counts",
  summary:
    "How many guests and robots viewed a page in the last 15 minutes (the online window). The " +
    "numbers are the same for every viewer and may be up to half a minute old. Requires " +
    "site.view and member.viewList.",
  kind: "read",
  input: Empty,
  output: z.object({
    guests: z.number().int().nonnegative(),
    robots: z.number().int().nonnegative(),
  }),
});

export const siteStats = defineContract({
  name: "site.stats",
  summary:
    "The site's totals: visible threads and messages in the forums guests can open, members " +
    "(banned, erased and waiting accounts left out) and the newest member. The numbers are the " +
    "same for every viewer and may be up to ten minutes old; `latestMember` is null unless the " +
    "viewer holds profile.view and member.viewList, and is the minimal card (`card.restricted` " +
    "true) when they may not open that profile. Requires site.view.",
  kind: "read",
  input: Empty,
  output: z.object({
    threads: z.number().int().nonnegative(),
    posts: z.number().int().nonnegative(),
    members: z.number().int().nonnegative(),
    latestMember: MemberCard.nullable(),
  }),
});

// Member of the month --------------------------------------------------------------------------

/** What a member did in one calendar month (UTC) and the points it is worth. */
export const StandingEntry = z
  .object({
    card: MemberCard,
    /** Visible posts written in the month. */
    posts: z.number().int().nonnegative(),
    /** Reactions received in the month. */
    reactions: z.number().int().nonnegative(),
    /** Members referred in the month. */
    referrals: z.number().int().nonnegative(),
    /** Points, to one decimal, from the site's standing settings. */
    points: z.number().nonnegative(),
  })
  .meta({ id: "StandingEntry" });

/** `current`, `previous` or a month as `YYYY-MM`. */
export const StandingMonth = z
  .string()
  .regex(/^(current|previous|\d{4}-(0[1-9]|1[0-2]))$/, "Use current, previous or YYYY-MM.")
  .describe("`current`, `previous` or a calendar month as YYYY-MM (UTC).");

export const standingsMonth = defineContract({
  name: "standings.month",
  summary:
    "The standing of one calendar month (UTC), most points first; ties go to more posts, then " +
    "to the older account. Only members with points are listed; banned members and members " +
    "whose profile the viewer may not open are left out. `current` is the month in progress, " +
    "recomputed in the background every few minutes; `previous` is the last complete month; " +
    "`YYYY-MM` names any month from 2000 to the current one (a month before the previous one keeps " +
    "no standing, so it lists nobody; its winner is in standings.winners). A month after the " +
    "current one, or before 2000, is a validation error. `scoring` gives the weights the points are made of. " +
    "Requires site.view, profile.view and member.viewList.",
  kind: "read",
  input: z.object({ month: StandingMonth.default("current"), ...pageInput }),
  output: Page(StandingEntry).extend({
    year: z.number().int(),
    /** 1 to 12. */
    month: z.number().int().min(1).max(12),
    /** How a member's points are counted, from the site's settings. */
    scoring: z.object({
      /** Points for each visible post. */
      postPoints: z.number().int().nonnegative(),
      /** Reactions received that make one point. */
      reactionsPerPoint: z.number().int().positive(),
      /** Points for each member referred. */
      referralPoints: z.number().int().nonnegative(),
    }),
  }),
});

export const standingsWinners = defineContract({
  name: "standings.winners",
  summary:
    "The member of the month of past months, newest month first: the member with the most " +
    "points in the month under the site's current rules (weights, staff, listed members and " +
    "the exclusion rule leave members out, and so do banned and erased accounts). A change of " +
    "those rules, a ban or its lifting, or an erasure decides past months again in the " +
    "background, newest first, and a month's winner is replaced without telling the member " +
    "who held it. A month in which nobody scored has no " +
    "winner and is left out, and so is a month whose winner is banned or has a profile the " +
    "viewer may not open. The first item is the current member of the month when it is last " +
    "month's. Requires site.view, profile.view and member.viewList.",
  kind: "read",
  input: z.object({ limit: z.number().int().min(1).max(24).default(12) }),
  output: z.object({
    items: z.array(
      StandingEntry.extend({
        year: z.number().int(),
        month: z.number().int().min(1).max(12),
      }),
    ),
  }),
});

export const usersChangeUsername = defineContract({
  name: "users.changeUsername",
  summary:
    "Change your own username. Requires profile.editOwn. Free for holders of profile.renameFree; " +
    "otherwise it also requires the shop purchase permission (shop.buy) and takes one " +
    "unit of a `usernameChange` shop item from the inventory (a conflict when there is none). " +
    "The name obeys the registration rules and must be free, compared without regard to case " +
    "(changing only the case of one's own name is allowed). The unit is taken first and given " +
    "back if the change does not happen. Refused (forbidden) for a member who holds " +
    "profile.renameNeedsApproval, and once profile.renameLimit changes were made within " +
    "profile.renameWindowDays days.",
  kind: "write",
  input: z.object({ username: z.string().trim().min(1).max(64) }),
  output: z.object({
    username: z.string(),
    /** Units of `usernameChange` items left; null for holders of profile.renameFree. */
    remaining: z.number().int().nonnegative().nullable(),
  }),
});
