import { escapeHtml } from "../../bbcode/escape";
import { type Ctx, prepared } from "../../context";
import { GUEST_ACCOUNT_ID } from "../../db/schema";
import { type Language, languageFor, phrase, phraseOr } from "../../i18n";
import type { PushPhraseRenderer } from "../push/delivery";
import { readSiteSettings } from "../settings";
import { phraseCount } from "./types";

type PhraseValues = {
  actor_count: number;
  actor: string | null;
  title: string | null;
  conversation_title: string | null;
  profile: string | null;
  poster: string | null;
  poster_id: number | null;
  own: "yes" | "no";
};

/** Where the notice's content lives, which picks the wording of the phrases that vary by place. */
const PLACE: Record<string, "thread" | "conversation" | "profile" | "comment"> = {
  thread: "thread",
  post: "thread",
  conversation: "conversation",
  conversation_message: "conversation",
  profile_post: "profile",
  profile_post_comment: "comment",
};

/**
 * The names a push text uses, all read from the notice's own row: the newest actor, the thread
 * title, the direct message title (only when the recipient is an active participant) and, for wall
 * content, the wall owner and the author of the wall post.
 */
function phraseValues(ctx: Ctx, notificationId: number): PhraseValues | null {
  return prepared(ctx, "notifications.phraseValues", () =>
    ctx.sqlite.prepare<PhraseValues, [number]>(
      `SELECT n.actor_count, a.username AS actor, t.title,
         CASE WHEN cp.user_id IS NOT NULL THEN c.title END AS conversation_title,
         owner.username AS profile, poster.username AS poster, pp.user_id AS poster_id,
         CASE WHEN pp.profile_user_id = n.user_id THEN 'yes' ELSE 'no' END AS own
       FROM notifications n
       LEFT JOIN users a ON a.id = n.actor_id
       LEFT JOIN threads t ON t.id = n.thread_id
       LEFT JOIN conversation_messages cm
         ON n.content_type = 'conversation_message' AND cm.id = n.content_id
       LEFT JOIN conversations c
         ON c.id = CASE n.content_type WHEN 'conversation' THEN n.content_id ELSE cm.conversation_id END
       LEFT JOIN conversation_participants cp
         ON cp.conversation_id = c.id AND cp.user_id = n.user_id AND cp.state = 'active'
       LEFT JOIN profile_post_comments pc
         ON n.content_type = 'profile_post_comment' AND pc.id = n.content_id
       LEFT JOIN profile_posts pp
         ON pp.id = CASE n.content_type WHEN 'profile_post' THEN n.content_id ELSE pc.profile_post_id END
       LEFT JOIN users owner ON owner.id = pp.profile_user_id
       LEFT JOIN users poster ON poster.id = pp.user_id
       WHERE n.id = ?1`,
    ),
  ).get(notificationId);
}

/** The text that names the member and the place, or null when the notice lacks either. */
function namedBody(
  language: Language,
  type: string,
  contentType: string,
  row: PhraseValues,
): string | null {
  if (!row.actor) return null;
  const place = PLACE[contentType];
  const title = place === "conversation" ? row.conversation_title : row.title;
  const needsTitle = place === "thread" || place === "conversation";
  const needsWall = place === "profile" || place === "comment";
  if ((needsTitle && !title) || (needsWall && !row.profile)) return null;
  const others = row.actor_count - 1;
  const values = {
    actor: row.actor,
    actors: phrase(language, "notification.push.actors", { name: row.actor, others }),
    count: row.actor_count,
    title: title ?? "",
    profile: row.profile ?? "",
    // A wall post a member left behind when they deleted their account belongs to the guest account.
    poster:
      row.poster_id === GUEST_ACCOUNT_ID ? phrase(language, "author.guest") : (row.poster ?? ""),
    own: row.own,
  };
  const key = `notification.${type}.push`;
  const named = phraseOr(language, `${key}.${place}`, "", values);
  return named || phraseOr(language, key, "", values) || null;
}

/**
 * Renders a notice's localized title and body for push, in the member's language (the push
 * module passes the site default when the member has none). The body names the member who acted
 * and the place (thread, direct message or wall) where the notice has them; staff and system
 * notices keep their general text. Phrases receive the thread title, the site name and the
 * notice's actor count (grouped notices pluralize on it). The names are not checked against what
 * the recipient may see: call it only after the push job has confirmed the recipient can see the
 * content (`visibleContent`), as `registerPushJobs` does.
 */
export function notificationPushPhrase(ctx: Ctx): PushPhraseRenderer {
  return (item, language) => {
    const row = phraseValues(ctx, item.notificationId);
    const settings = readSiteSettings(ctx);
    const lang = languageFor(language, settings.defaultLanguage);
    const values = {
      site: settings.siteName,
      title: row?.title ?? "",
      count: phraseCount(item.type, item.data, row?.actor_count ?? 1),
    };
    // A staff alert is its text.
    const bodyHtml = escapeHtml(
      item.type === "admin.alert" && typeof item.data.message === "string"
        ? item.data.message
        : ((row && namedBody(lang, item.type, item.contentType, row)) ??
            phrase(lang, `notification.${item.type}.body`, values)),
    );
    // Notification phrases never quote message text, so the private form is the same body.
    return {
      title: phrase(lang, `notification.${item.type}.title`, values),
      bodyHtml,
      bodyWithoutContentHtml: bodyHtml,
    };
  };
}
