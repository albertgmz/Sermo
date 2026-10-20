import { type Ctx, prepared } from "../../context";
import { type Brand, DEFAULT_ACCENT } from "../../mail/template";
import { catalogs } from "../appearance/store";
import type { readSiteSettings } from "../settings";
import { publicPicture } from "../storage/url";

/**
 * What every email shows of the site, from the settings the caller has already read: the
 * pictures and the accent come from the settings and the cached appearance catalogs, so the only
 * query of its own is the contact page's (one indexed lookup). A batch builds it once.
 */
export function siteBranding(ctx: Ctx, settings: ReturnType<typeof readSiteSettings>): Brand {
  const home = ctx.config.siteBaseURL ?? ctx.config.auth?.baseURL ?? "http://localhost:3000";
  const absolute = (fileId: number | null) => {
    const picture = publicPicture(ctx, fileId);
    return picture ? new URL(picture.url, home).href : null;
  };
  // The accent a visitor sees before choosing one: the palette's first.
  const accent = catalogs(ctx).activeColors.accent[0];
  const contact = prepared(ctx, "email.contactPage", () =>
    ctx.sqlite.prepare<{ id: number }, []>(
      "SELECT id FROM static_pages WHERE slug = 'contact' AND is_published = 1",
    ),
  ).get();
  return {
    name: settings.siteName,
    url: home,
    logoUrl: absolute(settings.logoFileId),
    iconUrl: absolute(settings.iconFileId),
    accent: accent?.color ?? DEFAULT_ACCENT.color,
    accentForeground: accent?.foreground ?? DEFAULT_ACCENT.foreground,
    contactUrl: contact ? new URL("/contact", home).href : null,
    preferencesUrl: new URL("/account/notifications", home).href,
  };
}
