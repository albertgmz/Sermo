import type { Ctx } from "@sermo/core";
import { readSiteSettings } from "@sermo/core";

/** Sets the site's default language. A test reads English text unless it says otherwise. Tests only. */
export function siteLanguage(ctx: Ctx, defaultLanguage: "en" | "es") {
  ctx.sqlite
    .prepare(
      "INSERT INTO site_settings (key, value, updated_at) VALUES ('configuration', ?1, 0) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
    )
    .run(JSON.stringify({ ...readSiteSettings(ctx), defaultLanguage }));
}
