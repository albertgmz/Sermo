import type * as z from "zod";
import type { Actor } from "../../actor";
import { requireAuthenticated } from "../../actor";
import { type Ctx, prepared } from "../../context";
import { SiteSettings, settingsGet, settingsUpdate } from "../../contracts/settings";
import { writeTx } from "../../db/tx";
import { ValidationError } from "../../errors";
import { implement } from "../../operation";
import { currentActor, requirePermission } from "../../permissions";
import { assertRule } from "../../shared/criteria";
import { attachUploadedFile, releaseFile } from "../images/attach";
import { requestStandingsRedecide } from "../members/redecide-request";
import { appendModeratorLog } from "../moderation";
import { assertHomeTab } from "./home-tab";
import { storedTurnstileSecret, storeTurnstileSecret } from "./turnstile";

export type SiteSettingsValue = z.infer<typeof SiteSettings>;
type StoredSiteSettingsValue = Omit<
  SiteSettingsValue,
  "groupUploadLimitBytes" | "turnstileSecretSet"
>;
const StoredSiteSettings = SiteSettings.omit({
  groupUploadLimitBytes: true,
  turnstileSecretSet: true,
});
/** What settings.update takes: the settings that can change, and the write-only Turnstile secret. */
type SettingsChanges = z.infer<typeof settingsUpdate.input>;

/** The settings that decide who wins a month (and the points): a change decides past months again. */
const STANDING_RULES = [
  "standingPostPoints",
  "standingReactionsPerPoint",
  "standingReferralPoints",
  "standingExcludeStaff",
  "standingExcludedUserIds",
  "standingExcludeRule",
] as const;

const defaults: StoredSiteSettingsValue = {
  maxUploadBytes: 25 * 1024 * 1024,
  allowedUploadTypes: {
    attachment: [
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/gif",
      "application/pdf",
      "text/plain",
      "video/mp4",
      "video/webm",
      "video/quicktime",
      "audio/mpeg",
      "audio/mp4",
      "audio/ogg",
      "audio/wav",
    ],
    avatar: ["image/jpeg", "image/png", "image/webp", "image/gif"],
    cover: ["image/jpeg", "image/png", "image/webp", "image/gif"],
    node_icon: ["image/jpeg", "image/png", "image/webp", "image/gif"],
    node_cover: ["image/jpeg", "image/png", "image/webp", "image/gif"],
  },
  firstPostsToModerate: 0,
  moderateLinksFromNewMembers: false,
  newMemberDays: 7,
  floodSeconds: 0,
  linksRule: { match: "all", conditions: [] },
  approvalRule: { match: "all", conditions: [] },
  approveSignups: false,
  registrationOpen: true,
  minimumAge: 0,
  registrationFields: [],
  requireEmailConfirmation: true,
  feedExcludedForumIds: [],
  homeTab: { rules: [], fallback: "latest" },
  threadTitleTemplate: "{title} | {site}",
  nodeTitleTemplate: "{title} | {site}",
  profileTitleTemplate: "{username} | {site}",
  indexNowKey: null,
  siteName: "Sermo",
  siteDescription: "",
  defaultLanguage: "en",
  newMemberMentionLimit: 3,
  profilePostsEnabled: true,
  forumStatsEnabled: false,
  notificationRetentionDays: 90,
  // Per-type channel defaults. An email value for a watch type (thread.watched, node.thread,
  // node.post) does not affect delivery: the watch's own email flag decides.
  notificationDefaults: {},
  emailHourlyCap: 20,
  conversationEmailIncludesBody: false,
  digestInactiveDays: 3,
  levelStep: 100,
  levelTitles: [
    { level: 1, title: "New member" },
    { level: 2, title: "Member" },
    { level: 4, title: "Senior member" },
  ],
  signatureMaxLength: 300,
  signatureMaxLines: 4,
  signatureMaxLinks: 3,
  signatureMaxImages: 1,
  signatureMaxSmilies: 5,
  signatureMaxTextSize: 4,
  signatureFormats: ["bold", "italic", "strikethrough", "code", "link"],
  signatureRule: { match: "all", conditions: [] },
  customTitleMaxLength: 40,
  standingPostPoints: 1,
  standingReactionsPerPoint: 10,
  standingReferralPoints: 20,
  standingExcludeStaff: false,
  standingExcludeRule: { match: "all", conditions: [] },
  standingExcludedUserIds: [],
  analytics: { provider: "none" },
  matomoCookieless: false,
  cookieBannerOutsideEu: true,
  cookiePolicyVersion: 1,
  socialLinks: { discord: null, telegram: null, x: null },
  logoFileId: null,
  iconFileId: null,
  backdropFileId: null,
  turnstileEnabled: false,
  turnstileSiteKey: "",
  turnstileForms: ["register", "passwordReset", "resendConfirmation"],
};

export function readSiteSettings(ctx: Ctx): StoredSiteSettingsValue {
  const row = prepared(ctx, "settings.read", () =>
    ctx.sqlite.prepare<{ value: string }, []>(
      "SELECT value FROM site_settings WHERE key = 'configuration'",
    ),
  ).get();
  return row ? StoredSiteSettings.parse(JSON.parse(row.value)) : structuredClone(defaults);
}

/** Stores the configuration (everything but the group quotas, which are permission entries). */
export function storeSiteSettings(ctx: Ctx, stored: StoredSiteSettingsValue): void {
  ctx.sqlite
    .prepare(
      "INSERT INTO site_settings (key, value, updated_at) VALUES ('configuration', ?1, ?2) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    )
    .run(JSON.stringify(stored), ctx.now());
}

export const settingsQuotaSql =
  "SELECT e.group_id, e.value FROM permission_entries e WHERE e.permission_id = (SELECT id FROM permission_definitions WHERE key = 'attachment.storageQuota') AND e.group_id IN (1,2,3,4) AND e.user_id = 0 AND e.node_id = 0";

function quotaRows(ctx: Ctx): { group_id: number; value: number }[] {
  return prepared(ctx, "settings.storageQuota", () =>
    ctx.sqlite.prepare<{ group_id: number; value: number }, []>(settingsQuotaSql),
  ).all();
}

function quotaView(rows: readonly { group_id: number; value: number }[]): Record<string, number> {
  const groupUploadLimitBytes: Record<string, number> = { "1": 0, "2": 0, "3": 0, "4": 0 };
  for (const quota of rows) {
    if (quota.value === -1) delete groupUploadLimitBytes[String(quota.group_id)];
    else groupUploadLimitBytes[String(quota.group_id)] = quota.value;
  }
  return groupUploadLimitBytes;
}

/** The settings that hold one of the site's own pictures, and the purpose their file is uploaded with. */
const SITE_PICTURES = [
  ["logoFileId", "site_logo"],
  ["iconFileId", "site_icon"],
  ["backdropFileId", "site_backdrop"],
] as const;

function assertCheapRule(ctx: Ctx, key: string, rule: SiteSettingsValue["linksRule"]): void {
  try {
    assertRule(ctx, rule, "cheap");
  } catch (error) {
    if (error instanceof ValidationError)
      throw new ValidationError(error.message, [{ path: [key], message: error.message }]);
    throw error;
  }
}

export function updateSiteSettings(
  ctx: Ctx,
  actor: Actor,
  changes: SettingsChanges,
): SiteSettingsValue {
  requirePermission(ctx, actor, "admin.settings");
  const user = requireAuthenticated(actor);
  return writeTx(ctx, () => {
    requirePermission(ctx, currentActor(ctx, actor), "admin.settings");
    const rows = quotaRows(ctx);
    const current = readSiteSettings(ctx);
    for (const [key, purpose] of SITE_PICTURES) {
      const wanted = changes[key];
      if (wanted === undefined || wanted === current[key]) continue;
      if (wanted !== null) attachUploadedFile(ctx, user.userId, wanted, purpose);
      if (current[key] !== null) releaseFile(ctx, current[key]);
    }
    // Both rules are decided on every write, so only criteria that read the member's own row.
    for (const key of [
      "linksRule",
      "approvalRule",
      "signatureRule",
      "standingExcludeRule",
    ] as const) {
      const rule = changes[key];
      if (rule) assertCheapRule(ctx, key, rule);
    }
    if (changes.homeTab) assertHomeTab(ctx, changes.homeTab);
    // Lists are sets: a kind or a form named twice counts once.
    const { turnstileSecret, ...settingChanges } = changes;
    if (settingChanges.signatureFormats)
      settingChanges.signatureFormats = [...new Set(settingChanges.signatureFormats)];
    if (settingChanges.turnstileForms)
      settingChanges.turnstileForms = [...new Set(settingChanges.turnstileForms)];
    if (settingChanges.registrationFields)
      settingChanges.registrationFields = [...new Set(settingChanges.registrationFields)];
    if (settingChanges.feedExcludedForumIds) {
      const ids = [...new Set(settingChanges.feedExcludedForumIds)];
      settingChanges.feedExcludedForumIds = ids;
      const known = new Set(
        prepared(ctx, "settings.nodeIds", () =>
          ctx.sqlite.prepare<{ id: number }, [string]>(
            "SELECT id FROM nodes WHERE id IN (SELECT value FROM json_each(?1))",
          ),
        )
          .all(JSON.stringify(ids))
          .map((row) => row.id),
      );
      const unknown = ids.filter((id) => !known.has(id));
      if (unknown.length > 0) {
        const message = `There is no forum with id ${unknown.join(", ")}.`;
        throw new ValidationError(message, [{ path: ["feedExcludedForumIds"], message }]);
      }
    }
    const secretSet =
      turnstileSecret === undefined
        ? storedTurnstileSecret(ctx) !== null
        : turnstileSecret !== null;
    const next = SiteSettings.parse({
      ...current,
      groupUploadLimitBytes: quotaView(rows),
      ...settingChanges,
      turnstileSecretSet: secretSet,
    });
    if (next.turnstileEnabled && (next.turnstileSiteKey === "" || !secretSet)) {
      const message =
        "Turnstile needs a site key and a secret before it can be turned on, and neither can be removed while it is on.";
      throw new ValidationError(message, [{ path: ["turnstileEnabled"], message }]);
    }
    if (turnstileSecret !== undefined) storeTurnstileSecret(ctx, turnstileSecret);
    if (changes.groupUploadLimitBytes !== undefined) {
      const previous = new Map(rows.map((row) => [row.group_id, row.value]));
      const setQuota = ctx.sqlite.prepare(
        "INSERT INTO permission_entries (permission_id, node_id, group_id, user_id, value) SELECT id, 0, ?1, 0, ?2 FROM permission_definitions WHERE key = 'attachment.storageQuota' ON CONFLICT (group_id, user_id, node_id, permission_id) DO UPDATE SET value = excluded.value",
      );
      for (const groupId of [1, 2, 3, 4]) {
        const value = changes.groupUploadLimitBytes[String(groupId)] ?? -1;
        if (value !== (previous.get(groupId) ?? 0)) setQuota.run(groupId, value);
      }
    }
    const { groupUploadLimitBytes: _quota, turnstileSecretSet: _secret, ...stored } = next;
    storeSiteSettings(ctx, stored);
    // The rules that decide who wins a month changed: past winners are decided again.
    // The listed members are a set: the same ones in another order change nothing.
    const asKey = (value: unknown) =>
      JSON.stringify(
        Array.isArray(value) && typeof value[0] === "number" ? [...value].sort() : value,
      );
    if (STANDING_RULES.some((key) => asKey(current[key]) !== asKey(next[key])))
      requestStandingsRedecide(ctx);
    appendModeratorLog(ctx, actor, "settings.update", "settings", 1, "", {
      changedKeys: Object.keys(changes),
    });
    return next;
  });
}

export const operations = [
  implement(settingsGet, (ctx, actor) => {
    requirePermission(ctx, actor, "admin.settings");
    return {
      ...readSiteSettings(ctx),
      groupUploadLimitBytes: quotaView(quotaRows(ctx)),
      turnstileSecretSet: storedTurnstileSecret(ctx) !== null,
    };
  }),
  implement(settingsUpdate, updateSiteSettings),
];
