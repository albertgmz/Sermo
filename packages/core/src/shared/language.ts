import { type Actor, actorUserId } from "../actor";
import { type Ctx, prepared } from "../context";
import { type Language, languageFor, phraseOr } from "../i18n";
import { readSiteSettings } from "../modules/settings";
import { markPublic } from "../operation";

/**
 * The language a viewer reads in: their own when they chose one, else the site's. One point
 * lookup for a signed-in viewer, none for a guest. Call it once per response.
 */
export const viewerLanguage = markPublic(
  "Reads the actor's own language setting; it decides nothing.",
  (ctx: Ctx, actor: Actor): Language => {
    const id = actorUserId(actor);
    const own =
      id === null
        ? null
        : (prepared(ctx, "shared.viewerLanguage", () =>
            ctx.sqlite.prepare<{ language: string | null }, [number]>(
              "SELECT language FROM users WHERE id = ?1",
            ),
          ).get(id)?.language ?? null);
    return languageFor(own, readSiteSettings(ctx).defaultLanguage);
  },
);

/** A readable title from an id such as `forum.viewLog` or `post_count`: "Forum view log". */
export function readableTitle(id: string): string {
  const words = id
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[._-]+/g, " ")
    .trim()
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The phrase for a key in the viewer's language, or a readable title made from the id. */
export function titleFor(language: Language, key: string, id: string): string {
  return phraseOr(language, key, readableTitle(id));
}

/** The phrase for a key, or an empty string when the catalogue has none. */
export function helpFor(language: Language, key: string): string {
  return phraseOr(language, key, "");
}

/** Definitions that carry phrase keys (`label`, `description`), with the resolved `title` and `help`. */
export function withTitles<T extends { id: string; label: string; description: string }>(
  language: Language,
  items: readonly T[],
): (T & { title: string; help: string })[] {
  return items.map((item) => ({
    ...item,
    title: titleFor(language, item.label, item.id),
    help: helpFor(language, item.description),
  }));
}
