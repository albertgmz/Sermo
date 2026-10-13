import * as z from "zod";
import { AWARD_TIERS } from "../db/schema";
import { defineContract } from "../operation";
import { FramePlacement } from "./appearance";
import { Empty, Id, Ok, Page, pageInput, Timestamp } from "./common";
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
     * then answer a minimal card (id, username, avatar, frame, name colour and badges; the title
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
    "`restricted` is true: title empty, level 1.",
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
  })
  .meta({ id: "MemberAuthor" });

export const usersAuthors = defineContract({
  name: "users.authors",
  summary:
    "Up to 50 members as authors, in one call and in no particular order: each one's card, " +
    "profile cover, counters, level bounds, the awards they show and their signature. Unknown " +
    "ids are left out. Open to everyone, like users.cards: it holds only what is drawn around " +
    "that member's content wherever the content is visible. For a member whose profile the " +
    "viewer may not open the card is the minimal one (`card.restricted` true) and the cover is " +
    "null, the join date is the epoch, the counters are zero, the next level bound is 1, the " +
    "awards are empty and the signature is null: a client shows only the card.",
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
    "than `limit` items while `nextCursor` is non-null. Requires profile.view.",
  kind: "read",
  input: z.object({ sort: z.enum(MEMBER_SORTS).default("newest"), ...pageInput }),
  output: Page(MemberListItem),
});

export const usersStaff = defineContract({
  name: "users.staff",
  summary:
    "The members of the groups marked as staff (at most 200), highest group rank first, then " +
    "by username, each with the titles of their staff groups. Banned members are left out. " +
    "Requires profile.view.",
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
    "and members whose profile the viewer may not open are left out. Requires profile.view.",
  kind: "read",
  input: Empty,
  output: z.object({ items: z.array(MemberCard) }),
});

export const usersSetReferrer = defineContract({
  name: "users.setReferrer",
  summary:
    "Name the member who brought you here. Allowed once, during the first seven days of the " +
    "account, to members who may edit their own profile (profile.editOwn). Never yourself, " +
    "never a banned member, and never the member who named you as their referrer. The " +
    "referrer's referral count goes up by one.",
  kind: "write",
  input: z.object({ userId: Id }),
  output: Ok,
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

export const standingsMonth = defineContract({
  name: "standings.month",
  summary:
    "The standing of one calendar month (UTC), most points first; ties go to more posts, then " +
    "to the older account. Only members with points are listed; banned members and members " +
    "whose profile the viewer may not open are left out. `current` is the month in progress, " +
    "recomputed in the background every few minutes; `previous` is the last complete month. " +
    "Requires profile.view.",
  kind: "read",
  input: z.object({ month: z.enum(["current", "previous"]).default("current"), ...pageInput }),
  output: Page(StandingEntry).extend({
    year: z.number().int(),
    /** 1 to 12. */
    month: z.number().int().min(1).max(12),
  }),
});

export const standingsWinners = defineContract({
  name: "standings.winners",
  summary:
    "The member of the month of past months, newest month first: the member with the most " +
    "points when the month ended, fixed at that moment. A month in which nobody scored has no " +
    "winner and is left out, and so is a month whose winner is banned or has a profile the " +
    "viewer may not open. The first item is the current member of the month when it is last " +
    "month's. Requires profile.view.",
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
    "Change your own username. Free for holders of profile.renameFree; otherwise it takes one " +
    "unit of a `usernameChange` shop item from the inventory (a conflict when there is none). " +
    "The name obeys the registration rules and must be free, compared without regard to case " +
    "(changing only the case of one's own name is allowed). The unit is taken first and given " +
    "back if the change does not happen.",
  kind: "write",
  input: z.object({ username: z.string().trim().min(1).max(64) }),
  output: z.object({
    username: z.string(),
    /** Units of `usernameChange` items left; null for holders of profile.renameFree. */
    remaining: z.number().int().nonnegative().nullable(),
  }),
});
