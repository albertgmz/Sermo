import type * as z from "zod";
import type { Actor } from "../../actor";
import { type Ctx, prepared } from "../../context";
import { SiteSettings, settingsGet, settingsUpdate } from "../../contracts/settings";
import { writeTx } from "../../db/tx";
import { implement } from "../../operation";
import { requirePermission } from "../../permissions";
import { appendModeratorLog } from "../moderation";

export type SiteSettingsValue = z.infer<typeof SiteSettings>;
type StoredSiteSettingsValue = Omit<SiteSettingsValue, "groupUploadLimitBytes">;
const StoredSiteSettings = SiteSettings.omit({ groupUploadLimitBytes: true });

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
    ],
    avatar: ["image/jpeg", "image/png", "image/webp", "image/gif"],
    cover: ["image/jpeg", "image/png", "image/webp", "image/gif"],
    node_icon: ["image/jpeg", "image/png", "image/webp", "image/gif"],
    node_cover: ["image/jpeg", "image/png", "image/webp", "image/gif"],
  },
  firstPostsToModerate: 0,
  moderateLinksFromNewMembers: false,
  newMemberDays: 7,
  warningBanThreshold: 0,
  warningBanDays: 7,
  threadTitleTemplate: "{title} | {site}",
  nodeTitleTemplate: "{title} | {site}",
  profileTitleTemplate: "{username} | {site}",
  indexNowKey: null,
  siteName: "Sermo",
  defaultLanguage: "en",
  newMemberMentionLimit: 3,
  profilePostsEnabled: true,
  notificationRetentionDays: 90,
  // Per-type channel defaults. An email value for a watch type (thread.watched, node.thread,
  // node.post) does not affect delivery: the watch's own email flag decides.
  notificationDefaults: {},
  emailHourlyCap: 20,
  conversationEmailIncludesBody: false,
  digestInactiveDays: 3,
};

export function readSiteSettings(ctx: Ctx): StoredSiteSettingsValue {
  const row = prepared(ctx, "settings.read", () =>
    ctx.sqlite.prepare<{ value: string }, []>(
      "SELECT value FROM site_settings WHERE key = 'configuration'",
    ),
  ).get();
  return row ? StoredSiteSettings.parse(JSON.parse(row.value)) : structuredClone(defaults);
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

export function updateSiteSettings(
  ctx: Ctx,
  actor: Actor,
  changes: Partial<SiteSettingsValue>,
): SiteSettingsValue {
  requirePermission(ctx, actor, "admin.settings");
  return writeTx(ctx, () => {
    const rows = quotaRows(ctx);
    const next = SiteSettings.parse({
      ...readSiteSettings(ctx),
      groupUploadLimitBytes: quotaView(rows),
      ...changes,
    });
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
    const { groupUploadLimitBytes: _quota, ...stored } = next;
    ctx.sqlite
      .prepare(
        "INSERT INTO site_settings (key, value, updated_at) VALUES ('configuration', ?1, ?2) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
      )
      .run(JSON.stringify(stored), ctx.now());
    appendModeratorLog(ctx, actor, "settings.update", "settings", 1, "", {
      changedKeys: Object.keys(changes),
    });
    return next;
  });
}

export const operations = [
  implement(settingsGet, (ctx, actor) => {
    requirePermission(ctx, actor, "admin.settings");
    return { ...readSiteSettings(ctx), groupUploadLimitBytes: quotaView(quotaRows(ctx)) };
  }),
  implement(settingsUpdate, updateSiteSettings),
];
