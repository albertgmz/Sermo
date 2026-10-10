import { type Ctx, prepared } from "../../context";
import { languageFor, phrase } from "../../i18n";
import { escapeHtml } from "../../markdown/extensions";
import type { PushPhraseRenderer } from "../push/delivery";
import { readSiteSettings } from "../settings";

/**
 * Renders a notice's localized title and body for push, in the member's language (the push
 * module passes the site default when the member has none). Phrases receive the thread title,
 * the site name and the notice's actor count (grouped notices pluralize on it).
 */
export function notificationPushPhrase(ctx: Ctx): PushPhraseRenderer {
  return (item, language) => {
    const row = prepared(ctx, "notifications.phraseValues", () =>
      ctx.sqlite.prepare<{ actor_count: number; title: string | null }, [number]>(
        "SELECT n.actor_count, t.title FROM notifications n LEFT JOIN threads t ON t.id = n.thread_id WHERE n.id = ?1",
      ),
    ).get(item.notificationId);
    const settings = readSiteSettings(ctx);
    const lang = languageFor(language, settings.defaultLanguage);
    const values = {
      site: settings.siteName,
      title: row?.title ?? "",
      count: row?.actor_count ?? 1,
    };
    const bodyHtml = escapeHtml(phrase(lang, `notification.${item.type}.body`, values));
    // Notification phrases never quote message text, so the private form is the same body.
    return {
      title: phrase(lang, `notification.${item.type}.title`, values),
      bodyHtml,
      bodyWithoutContentHtml: bodyHtml,
    };
  };
}
