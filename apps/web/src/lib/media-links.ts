import { MAX_MEDIA_EMBEDS, mediaHtml, resolveMedia } from "@sermo/core/media";
import { mediaRefOf } from "@sermo/core/media-url";

// A stored link to a post or video page (`[MEDIA]` of a site the renderer once only linked, or
// that needs this site's name, like Twitch) becomes its player, drawn from the same table as the
// renderer's. Posts are not rewritten: this runs when they are shown, before the embed gate holds
// the player back until the visitor accepts it.
const LINK =
  /<a class="bb-media-link bb-media-([a-z]+)" href="([^"]*)"[^>]*>[^<]*<\/a>/g;

export function withMediaPlayers(html: string, origin?: string): string {
  if (!html.includes("bb-media-link")) return html;
  const parent = origin ? URL.parse(origin)?.hostname : undefined;
  let left = MAX_MEDIA_EMBEDS - (html.match(/<iframe\b/g)?.length ?? 0);
  return html.replace(LINK, (whole, site: string, href: string) => {
    if (left <= 0) return whole;
    const ref = mediaRefOf(href.replace(/&amp;/g, "&"));
    const media =
      ref?.site === site
        ? resolveMedia(site, ref.id, { players: true, parent })
        : null;
    if (media?.kind !== "iframe") return whole;
    left--;
    return mediaHtml(site, media);
  });
}
