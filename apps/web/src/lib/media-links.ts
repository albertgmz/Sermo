import { MAX_MEDIA_EMBEDS, mediaHtml, resolveMedia } from "@sermo/core/media";
import { mediaRefOf } from "@sermo/core/media-url";

// The name `[MEDIA=x]` stands for (kept out of a ternary the LITE scan would read as metadata).
const X_SITE = "twitter";

// A stored link to a post or video page (`[MEDIA]` of a site the renderer once only linked, or
// that needs this site's name (`siteUrl`, the configured public address, never the request's Host), like Twitch) becomes its player, drawn from the same table as the
// renderer's. Posts are not rewritten: this runs when they are shown, before the embed gate holds
// the player back until the visitor accepts it.
const LINK =
  /<a class="bb-media-link bb-media-([a-z]+)" href="([^"]*)"[^>]*>[^<]*<\/a>/g;

export function withMediaPlayers(html: string, siteUrl?: string): string {
  if (!html.includes("bb-media-link")) return html;
  const parent = siteUrl ? URL.parse(siteUrl)?.hostname : undefined;
  let left = MAX_MEDIA_EMBEDS - (html.match(/<iframe\b/g)?.length ?? 0);
  return html.replace(LINK, (whole, named: string, href: string) => {
    // `[MEDIA=x]` is the same site as `[MEDIA=twitter]`.
    const site = named === "x" ? X_SITE : named;
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
