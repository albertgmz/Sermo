import * as z from "zod";
import { HOME_TABS, UPLOAD_SETTING_PURPOSES } from "../db/schema";

export { HOME_TABS };

/** Languages with complete phrase catalogs. */
export const SUPPORTED_LANGUAGES = ["en", "es"] as const;

import { defineContract } from "../operation";
import { Empty, Id } from "./common";
import { CriteriaRule } from "./criteria";

const Mime = z
  .string()
  .regex(/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i)
  .max(100);
const MimeList = z.array(Mime).max(40);
const SocialUrl = z
  .string()
  .trim()
  .max(300)
  .regex(/^https?:\/\/[^\s]+$/i, "Use an http(s) URL.")
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are refused
  .refine((value) => !/[\u0000-\u001f\u007f\u200b-\u200f\u2028-\u202e\ufeff]/.test(value), {
    message: "Use an http(s) URL without control characters.",
  })
  .nullable();
export const Analytics = z
  .discriminatedUnion("provider", [
    z.object({ provider: z.literal("none") }),
    z.object({
      provider: z.literal("matomo"),
      /** The Matomo installation, e.g. `https://stats.example.com/`. */
      url: z
        .string()
        .trim()
        .max(300)
        .regex(/^https:\/\/[A-Za-z0-9.-]+(:\d+)?(\/[A-Za-z0-9._~/-]*)?$/, "Use an https URL."),
      siteId: z.number().int().min(1).max(1_000_000),
    }),
    z.object({
      provider: z.literal("google"),
      measurementId: z
        .string()
        .trim()
        .regex(/^G-[A-Z0-9]{4,20}$/, "Use a G- measurement id."),
    }),
  ])
  .meta({ id: "Analytics" });

/** The most rules the site's home tab setting holds. */
export const MAX_HOME_TAB_RULES = 10;

/**
 * Which tab of the home page a visitor who chose none opens on: the tab of the first rule they
 * meet (cheap criteria only), else `fallback`. Guests are decided by the same rules, and a tab
 * `following` (it needs an account) cannot be picked by a rule a guest meets, nor as the fallback.
 */
export const HomeTabSetting = z
  .object({
    rules: z
      .array(z.object({ rule: CriteriaRule, tab: z.enum(HOME_TABS) }))
      .max(MAX_HOME_TAB_RULES),
    fallback: z.enum(HOME_TABS),
  })
  .meta({ id: "HomeTabSetting" });

export const SiteSettings = z
  .object({
    maxUploadBytes: z.number().int().min(1).max(1_073_741_824),
    /** Per member-facing purpose. Catalog and site pictures always take JPEG, PNG and WebP. */
    allowedUploadTypes: z.record(z.enum(UPLOAD_SETTING_PURPOSES), MimeList),
    groupUploadLimitBytes: z.record(z.string().regex(/^[1-4]$/), z.number().int().min(0)),
    firstPostsToModerate: z.number().int().min(0).max(100),
    moderateLinksFromNewMembers: z.boolean(),
    newMemberDays: z.number().int().min(1).max(365).default(7),
    /**
     * Seconds a member must wait between two posts: threads, replies, wall posts, wall comments
     * and conversation messages share one clock. 0 turns it off; antispam.bypassFlood is exempt.
     */
    floodSeconds: z.number().int().min(0).max(3600).default(0),
    /**
     * A member whose text holds a link, or a picture or media from another site, must hold this
     * rule to post it (cheap criteria only: the member's own row, checked on every write). An
     * empty rule means everyone may.
     */
    linksRule: CriteriaRule.default({ match: "all", conditions: [] }),
    /**
     * New threads and replies wait for approval until the member holds this rule (cheap criteria
     * only), on top of firstPostsToModerate and each forum's own approval switches. An empty rule
     * means nobody is held back.
     */
    approvalRule: CriteriaRule.default({ match: "all", conditions: [] }),
    /** The home page tab of members who chose none, and of guests. */
    homeTab: HomeTabSetting.default({ rules: [], fallback: "latest" }),
    warningBanThreshold: z.number().int().min(0).max(1000),
    warningBanDays: z.number().int().min(1).max(3650),
    threadTitleTemplate: z.string().min(1).max(200),
    nodeTitleTemplate: z.string().min(1).max(200),
    profileTitleTemplate: z.string().min(1).max(200),
    indexNowKey: z
      .string()
      .regex(/^[A-Za-z0-9-]{8,128}$/)
      .nullable(),
    /** Shown in emails and titles. */
    siteName: z.string().trim().min(1).max(100).default("Sermo"),
    /** A sentence about the site, for the meta description and the footer; empty when none. */
    siteDescription: z.string().trim().max(300).default(""),
    /** Language for guests and members who have not chosen one. */
    defaultLanguage: z.enum(SUPPORTED_LANGUAGES).default("en"),
    /** Mentions per item for members younger than newMemberDays (mention.maxPerItem applies too). */
    newMemberMentionLimit: z.number().int().min(0).max(100).default(3),
    /** Off: nobody can create profile posts or comments. */
    profilePostsEnabled: z.boolean().default(true),
    /** On: the forum list shows the forum statistics panel (the ranked thread lists). */
    forumStatsEnabled: z.boolean().default(false),
    /** Read notifications older than this are purged. */
    notificationRetentionDays: z.number().int().min(1).max(3650).default(90),
    /** Admin defaults per notification type and channel; types not listed use their registry defaults. */
    notificationDefaults: z
      .record(z.string(), z.object({ inApp: z.boolean(), email: z.boolean(), push: z.boolean() }))
      .default({}),
    /** Notification emails per member per hour (security emails are never capped). */
    emailHourlyCap: z.number().int().min(0).max(1000).default(20),
    /** Conversation emails include the message text only when true. */
    conversationEmailIncludesBody: z.boolean().default(false),
    /** The weekly digest goes to members who have not visited for at least this many days. */
    digestInactiveDays: z.number().int().min(1).max(365).default(3),
    /**
     * Levels come from the XP of the awards a member holds. Each level costs `levelStep` more XP
     * than the one before: level n starts at levelStep * n * (n - 1) / 2.
     */
    levelStep: z.number().int().min(1).max(1_000_000).default(100),
    /** The title of a level is the entry with the highest `level` not above it. */
    levelTitles: z
      .array(
        z.object({
          level: z.number().int().min(1).max(10_000),
          title: z.string().trim().min(1).max(40),
        }),
      )
      .max(50)
      .default([
        { level: 1, title: "New member" },
        { level: 2, title: "Member" },
        { level: 4, title: "Senior member" },
      ]),
    /** Limits of a signature (profile.signature) and of a custom title (profile.customTitle). */
    signatureMaxLength: z.number().int().min(1).max(2000).default(300),
    signatureMaxLines: z.number().int().min(1).max(20).default(4),
    customTitleMaxLength: z.number().int().min(1).max(100).default(40),
    /**
     * Member of the month: points = posts * standingPostPoints
     * + reactions received / standingReactionsPerPoint + referrals * standingReferralPoints.
     */
    standingPostPoints: z.number().int().min(0).max(1000).default(1),
    standingReactionsPerPoint: z.number().int().min(1).max(1000).default(10),
    standingReferralPoints: z.number().int().min(0).max(1000).default(20),
    /** Members holding `moderation.access` or any admin permission are left out of the standings. */
    standingExcludeStaff: z.boolean().default(false),
    /** Members left out of the standings by hand (ids; the panel names them by username). */
    standingExcludedUserIds: z.array(Id).max(200).default([]),
    /**
     * Visitor analytics on every public page; `none` adds nothing. Matomo needs its http(s)
     * address and site id, Google Analytics its measurement id.
     */
    analytics: Analytics.default({ provider: "none" }),
    /**
     * The site's own pictures: an unattached file the actor uploaded with the purpose
     * `site_logo`, `site_icon` or `site_backdrop`. Setting one replaces (and deletes) the
     * previous file; null removes it.
     */
    /**
     * The site's own accounts elsewhere, shown in the footer: an http(s) URL per network, or
     * null to leave one out.
     */
    socialLinks: z
      .object({ discord: SocialUrl, telegram: SocialUrl, x: SocialUrl })
      .default({ discord: null, telegram: null, x: null }),
    logoFileId: Id.nullable().default(null),
    iconFileId: Id.nullable().default(null),
    backdropFileId: Id.nullable().default(null),
  })
  .meta({ id: "SiteSettings" });

export const settingsGet = defineContract({
  name: "settings.get",
  summary: "Get site configuration. Administrators only.",
  kind: "read",
  input: Empty,
  output: SiteSettings,
});

type WithoutDefaults<S> = { [K in keyof S]: S[K] extends z.ZodDefault<infer T> ? T : S[K] };

/**
 * The same fields with their defaults taken off. An update names only the keys it changes, and a
 * default on an optional input is filled in for every key the caller left out: it would silently
 * put each of those settings back to its default.
 */
function withoutDefaults<S extends z.ZodRawShape>(shape: S): WithoutDefaults<S> {
  return Object.fromEntries(
    Object.entries(shape).map(([key, field]) => [
      key,
      field instanceof z.ZodDefault ? field.unwrap() : field,
    ]),
  ) as WithoutDefaults<S>;
}

export const settingsUpdate = defineContract({
  name: "settings.update",
  summary:
    "Update site configuration: only the keys sent change, every other setting keeps its " +
    "stored value. Administrators only.",
  kind: "write",
  input: z.object(withoutDefaults(SiteSettings.shape)).partial(),
  output: SiteSettings,
});
