import * as z from "zod";
import { HOME_TABS, UPLOAD_SETTING_PURPOSES } from "../db/schema";

export { HOME_TABS };

/** Languages with complete phrase catalogs. */
export const SUPPORTED_LANGUAGES = ["en", "es"] as const;

import { defineContract } from "../operation";
import { Empty, Id } from "./common";
import { MAX_COOKIE_POLICY_VERSION } from "./consent";
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

/**
 * The kinds of formatting a signature may use, as the renderer produces them: a signature is
 * judged on its rendered HTML, so `bold` is `**x**` and `[B]x[/B]` alike. Quotes, tables, code
 * blocks, spoilers, media, attachments and indents are never allowed in a signature.
 */
export const SIGNATURE_FORMATS = [
  "bold",
  "italic",
  "underline",
  "strikethrough",
  "code",
  "color",
  "font",
  "size",
  "heading",
  "link",
  "image",
  "list",
  "align",
] as const;
export type SignatureFormat = (typeof SIGNATURE_FORMATS)[number];

/**
 * The guest forms Cloudflare Turnstile can guard. Every other form needs an account or a
 * single-use link from an email, which is its own proof.
 */
export const TURNSTILE_FORMS = [
  "register",
  "login",
  "passwordReset",
  "resendConfirmation",
] as const;
export type TurnstileForm = (typeof TURNSTILE_FORMS)[number];

/**
 * The profile fields a site can require at sign-up: the member's own profile fields (see
 * `profiles.update`). `birthday` asks the full date, year included.
 */
export const REGISTRATION_FIELDS = [
  "birthday",
  "location",
  "website",
  "about",
  "discord",
  "telegram",
  "x",
] as const;
export type RegistrationField = (typeof REGISTRATION_FIELDS)[number];

/** The most rules the site's home tab setting holds. */
export const MAX_HOME_TAB_RULES = 10;

/**
 * Which tab of the feed page (What's new) a visitor who chose none opens on: the tab of the first rule they
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
    /**
     * On: a new account waits for staff to approve it (see `signups.list`) once its email is
     * confirmed. Off by default; accounts already waiting stay in the queue when it is turned off.
     */
    approveSignups: z.boolean().default(false),
    /**
     * Whether visitors can register. Off: the sign-up endpoint refuses every visitor (code
     * `REGISTRATION_CLOSED`); accounts that exist, and the administrator the site is started
     * with, are not affected. On by default.
     */
    registrationOpen: z.boolean().default(true),
    /**
     * The youngest age that may register, in years; 0 asks for no age. Above 0 the sign-up asks
     * for the full date of birth and refuses a visitor younger than this (code
     * `UNDER_MINIMUM_AGE`); the age is in whole years by the UTC calendar day. 0 by default.
     */
    minimumAge: z.number().int().min(0).max(99).default(0),
    /**
     * The profile fields a visitor must fill in to register (code `REGISTRATION_FIELD_REQUIRED`
     * names the first missing one). A field that is not listed is not asked at sign-up: the sign-up
     * request (`POST /api/auth/sign-up/email`) carries the asked fields in a `profile` object
     * (`{ birthday: { year, month, day }, location, website, about, discord, telegram, x }`, the
     * strings as `profiles.update` takes them) and ignores any other key of it. Empty by default.
     */
    registrationFields: z
      .array(z.enum(REGISTRATION_FIELDS))
      .max(REGISTRATION_FIELDS.length)
      .default([]),
    /**
     * Whether a new account must confirm its email address before it joins the Member group. It
     * takes effect only on a site that sends account email (`SERMO_MAIL_DRIVER` other than
     * `none`): without a mail driver nobody can be asked. Accounts already unconfirmed stay so. Off, the
     * welcome email is sent at sign-up instead of after the confirmation.
     * On by default, which is how a site with a mail driver behaved before this setting.
     */
    requireEmailConfirmation: z.boolean().default(true),
    /**
     * Forums (or categories, with everything under them) the home feed leaves out for the whole
     * site: `feed.list` never lists their threads, whoever asks, even when a forum filter names
     * one. The forums themselves are untouched. Ids of forums that do not exist are refused.
     */
    feedExcludedForumIds: z.array(Id).max(100).default([]),
    /** The feed page tab of members who chose none, and of guests. */
    homeTab: HomeTabSetting.default({ rules: [], fallback: "latest" }),
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
    /**
     * Limits of a signature (profile.signature), checked when it is saved and measured on what
     * the renderer produces. Characters and lines count the source. The next four use the
     * anti-spam convention for counts: 0 and -1 both mean no limit (to forbid links or pictures,
     * leave the kind out of `signatureFormats`). `signatureMaxTextSize` is the largest
     * `[size]` (1 to 7) allowed; a heading counts as 8 minus its level (h1 is 7, h6 is 2).
     */
    signatureMaxLength: z.number().int().min(1).max(2000).default(300),
    signatureMaxLines: z.number().int().min(1).max(20).default(4),
    signatureMaxLinks: z.number().int().min(-1).max(50).default(3),
    signatureMaxImages: z.number().int().min(-1).max(20).default(1),
    /** Emoji, each pictograph on its own (a flag or keycap once); the forum has no text smilies. */
    signatureMaxSmilies: z.number().int().min(-1).max(100).default(5),
    signatureMaxTextSize: z.number().int().min(-1).max(7).default(4),
    /** The kinds of formatting a signature may use; one outside the list is refused when saved. */
    signatureFormats: z
      .array(z.enum(SIGNATURE_FORMATS))
      .max(SIGNATURE_FORMATS.length)
      .default(["bold", "italic", "strikethrough", "code", "link"]),
    /**
     * A member must hold this rule to set a signature, on top of profile.signature (cheap
     * criteria only: the member's own row). A signature stored by a member who no longer holds it
     * stays stored but is not shown. An empty rule means everyone who may.
     */
    signatureRule: CriteriaRule.default({ match: "all", conditions: [] }),
    /** Limit of a custom title (profile.customTitle). */
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
    /**
     * Members this rule matches are left out of the standings, like the staff and the members
     * listed below (cheap criteria only: the member's own row and groups). An empty rule excludes
     * nobody. Changing any of these settings recomputes the winners of past months.
     */
    standingExcludeRule: CriteriaRule.default({ match: "all", conditions: [] }),
    /** Members left out of the standings by hand (ids; the panel names them by username). */
    standingExcludedUserIds: z.array(Id).max(200).default([]),
    /**
     * Visitor analytics on every public page; `none` adds nothing. Matomo needs its http(s)
     * address and site id, Google Analytics its measurement id.
     */
    analytics: Analytics.default({ provider: "none" }),
    /**
     * Matomo without cookies: the tag runs in its cookieless mode and, when on, is not held back
     * for consent (the cookie policy page says so). Whether that is lawful varies by country.
     * Has no effect unless the analytics provider is Matomo.
     */
    matomoCookieless: z.boolean().default(false),
    /**
     * Show the cookie banner to visitors outside Europe as well (the default). Off: only visitors
     * in the EU, the EEA, the United Kingdom and Switzerland, or of unknown country, are asked;
     * everyone else is treated as having accepted until they choose otherwise in the settings.
     */
    cookieBannerOutsideEu: z.boolean().default(true),
    /**
     * The version of the cookie policy; raised only by `consent.askAgain`, which makes everyone
     * choose again. Not changed by `settings.update`.
     */
    cookiePolicyVersion: z.number().int().min(1).max(MAX_COOKIE_POLICY_VERSION).default(1),
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
    /**
     * Cloudflare Turnstile on the guest forms named in `turnstileForms` (sign-in is not among the
     * defaults: a wrong secret would lock the administrator out too). The backend verifies
     * every token with Cloudflare and refuses the form when the token is missing, wrong or
     * Cloudflare cannot be reached (it fails closed). It can be on only with a site key and a
     * secret stored.
     */
    turnstileEnabled: z.boolean().default(false),
    /** The public site key of the widget; empty when none is set. */
    turnstileSiteKey: z.string().trim().max(100).default(""),
    turnstileForms: z
      .array(z.enum(TURNSTILE_FORMS))
      .max(TURNSTILE_FORMS.length)
      .default(["register", "passwordReset", "resendConfirmation"]),
    /**
     * Whether a secret is stored. The secret itself is write-only: it is sent as
     * `turnstileSecret` to settings.update and no read returns it. Ignored on update.
     */
    turnstileSecretSet: z.boolean().default(false),
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

/** What `settings.update` may change: every setting but the ones with an operation of their own. */
const {
  cookiePolicyVersion: _askAgainOnly,
  turnstileSecretSet: _readOnly,
  ...UPDATABLE
} = SiteSettings.shape;

export const settingsUpdate = defineContract({
  name: "settings.update",
  summary:
    "Update site configuration: only the keys sent change, every other setting keeps its " +
    "stored value. `turnstileSecret` stores the Turnstile secret (write-only; null removes it, " +
    "and Turnstile cannot be on without one). Administrators only.",
  kind: "write",
  input: z
    .object(withoutDefaults(UPDATABLE))
    .extend({
      /** The Turnstile secret key to store; null removes it. Never returned by any read. */
      turnstileSecret: z.string().trim().min(1).max(200).nullable(),
    })
    .partial(),
  output: SiteSettings,
});
