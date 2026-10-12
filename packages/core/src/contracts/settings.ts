import * as z from "zod";
import { UPLOAD_SETTING_PURPOSES } from "../db/schema";

/** Languages with complete phrase catalogs. */
export const SUPPORTED_LANGUAGES = ["en", "es"] as const;

import { defineContract } from "../operation";
import { Empty, Id } from "./common";

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
  .nullable();
export const SiteSettings = z
  .object({
    maxUploadBytes: z.number().int().min(1).max(1_073_741_824),
    /** Per member-facing purpose. Catalog and site pictures always take JPEG, PNG and WebP. */
    allowedUploadTypes: z.record(z.enum(UPLOAD_SETTING_PURPOSES), MimeList),
    groupUploadLimitBytes: z.record(z.string().regex(/^[1-4]$/), z.number().int().min(0)),
    firstPostsToModerate: z.number().int().min(0).max(100),
    moderateLinksFromNewMembers: z.boolean(),
    newMemberDays: z.number().int().min(1).max(365).default(7),
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
    /** Language for guests and members who have not chosen one. */
    defaultLanguage: z.enum(SUPPORTED_LANGUAGES).default("en"),
    /** Mentions per item for members younger than newMemberDays (mention.maxPerItem applies too). */
    newMemberMentionLimit: z.number().int().min(0).max(100).default(3),
    /** Off: nobody can create profile posts or comments. */
    profilePostsEnabled: z.boolean().default(true),
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
