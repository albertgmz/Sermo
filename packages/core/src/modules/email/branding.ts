import { type Ctx, prepared } from "../../context";
import { type Brand, DEFAULT_ACCENT } from "../../mail/template";
import { catalogs } from "../appearance/store";
import type { readSiteSettings } from "../settings";
import { publicPicture } from "../storage/url";

/**
 * What every email shows of the site, from the settings the caller has already read: the
 * pictures and the accent come from the settings and the cached appearance catalogs, and its one
 * query looks up the contact page and the icon's small copy by index. A batch builds it once.
 */
export function siteBranding(ctx: Ctx, settings: ReturnType<typeof readSiteSettings>): Brand {
  const home = ctx.config.siteBaseURL ?? ctx.config.auth?.baseURL ?? "http://localhost:3000";
  const absolute = (fileId: number | null) => {
    const picture = publicPicture(ctx, fileId);
    return picture ? new URL(picture.url, home).href : null;
  };
  // The accent a visitor sees before choosing one: the palette's first.
  const accent = catalogs(ctx).activeColors.accent[0];
  // The icon is shown 40 px wide: its 192 px copy is sharp on a dense screen at a fraction of the
  // 512 px original's bytes.
  const row = prepared(ctx, "email.branding", () =>
    ctx.sqlite.prepare<{ contact: number | null; icon: number | null }, [number | null]>(
      "SELECT (SELECT id FROM static_pages WHERE slug = 'contact' AND is_published = 1) AS contact, (SELECT id FROM files WHERE parent_file_id = ?1 AND variant = 'icon_192' AND deleted_at IS NULL) AS icon",
    ),
  ).get(settings.iconFileId)!;
  return {
    name: settings.siteName,
    url: home,
    logoUrl: absolute(settings.logoFileId),
    iconUrl: absolute(row.icon ?? settings.iconFileId),
    accent: accent?.color ?? DEFAULT_ACCENT.color,
    accentForeground: accent?.foreground ?? DEFAULT_ACCENT.foreground,
    contactUrl: row.contact ? new URL("/contact", home).href : null,
    preferencesUrl: new URL("/account/notifications", home).href,
  };
}
