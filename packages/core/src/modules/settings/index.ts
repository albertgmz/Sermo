import type * as z from "zod";
import type { Actor } from "../../actor";
import { type Ctx, prepared } from "../../context";
import { SiteSettings, settingsGet, settingsUpdate } from "../../contracts/settings";
import { writeTx } from "../../db/tx";
import { implement } from "../../operation";
import { requireAdmin } from "../permissions";

export type SiteSettingsValue = z.infer<typeof SiteSettings>;

const defaults: SiteSettingsValue = {
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
  groupUploadLimitBytes: {
    "1": 0,
    "2": 100 * 1024 * 1024,
    "3": 1024 * 1024 * 1024,
    "4": 1024 * 1024 * 1024,
  },
  firstPostsToModerate: 0,
  moderateLinksFromNewMembers: false,
  warningBanThreshold: 0,
  warningBanDays: 7,
  threadTitleTemplate: "{title} | {site}",
  nodeTitleTemplate: "{title} | {site}",
  profileTitleTemplate: "{username} | {site}",
  indexNowKey: null,
};

export function readSiteSettings(ctx: Ctx): SiteSettingsValue {
  const row = prepared(ctx, "settings.read", () =>
    ctx.sqlite.prepare<{ value: string }, []>(
      "SELECT value FROM site_settings WHERE key = 'configuration'",
    ),
  ).get();
  return row ? SiteSettings.parse(JSON.parse(row.value)) : structuredClone(defaults);
}

export function updateSiteSettings(
  ctx: Ctx,
  actor: Actor,
  changes: Partial<SiteSettingsValue>,
): SiteSettingsValue {
  requireAdmin(ctx, actor);
  return writeTx(ctx, () => {
    const next = SiteSettings.parse({ ...readSiteSettings(ctx), ...changes });
    ctx.sqlite
      .prepare(
        "INSERT INTO site_settings (key, value, updated_at) VALUES ('configuration', ?1, ?2) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
      )
      .run(JSON.stringify(next), ctx.now());
    return next;
  });
}

export const operations = [
  implement(settingsGet, (ctx, actor) => {
    requireAdmin(ctx, actor);
    return readSiteSettings(ctx);
  }),
  implement(settingsUpdate, updateSiteSettings),
];
