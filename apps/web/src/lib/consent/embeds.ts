// Embedded players (`[MEDIA]`). The backend renders each as a sandboxed iframe; until the visitor
// accepts the embeds category, the page gets a placeholder in its place and the iframe's address
// is only carried as data. `EmbedLoader` (client) builds the player when one is loaded.

// The display name of each site `[MEDIA]` embeds as a player.
export const EMBED_PROVIDERS: Record<string, string> = {
  youtube: "YouTube",
  vimeo: "Vimeo",
  dailymotion: "Dailymotion",
  giphy: "Giphy",
  tiktok: "TikTok",
  spotify: "Spotify",
  soundcloud: "SoundCloud",
  applemusic: "Apple Music",
  instagram: "Instagram",
  // A computed key: the LITE scan reads this site name followed by a colon as page image metadata.
  ["twitter"]: "X",
  facebook: "Facebook",
  reddit: "Reddit",
  twitch: "Twitch",
};

// The hosts a player is served from, the iframe sandbox and the permissions it asks for: the same
// as the backend's sanitizer uses (`packages/core/src/bbcode/media.ts`; a test keeps them equal).
export const EMBED_HOSTS: readonly string[] = [
  "www.youtube-nocookie.com",
  "player.vimeo.com",
  "www.dailymotion.com",
  "open.spotify.com",
  "w.soundcloud.com",
  "embed.music.apple.com",
  "giphy.com",
  "www.tiktok.com",
  "www.instagram.com",
  "platform.twitter.com",
  "www.facebook.com",
  "embed.reddit.com",
  "player.twitch.tv",
  "clips.twitch.tv",
];
export const EMBED_SANDBOX =
  "allow-scripts allow-same-origin allow-presentation allow-popups";
export const EMBED_ALLOW: Record<"video" | "audio", string> = {
  video: "fullscreen; picture-in-picture",
  audio: "encrypted-media; fullscreen",
};

export type EmbedLabels = {
  hosted: (provider: string) => string;
  load: string;
  always: string;
  original: string;
};

// The address of a player the visitor may load: https, and one of the hosts above.
export function embedSource(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && EMBED_HOSTS.includes(url.hostname)
      ? url.href
      : null;
  } catch {
    return null;
  }
}

const IFRAME = /<iframe(?=\s)((?:"[^"]*"|'[^']*'|[^'">])*)>\s*<\/iframe>/gi;
const ATTRIBUTE = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
// An opening or closing iframe tag that is still there: up to its `>`, or the end of the text.
const LEFTOVER = /<\/?iframe\b[^>]*(?:>|$)/gi;
const SHAPES = new Set([
  "bb-media",
  "bb-media-video",
  "bb-media-audio",
  "bb-media-post",
]);

const escapeText = (text: string) =>
  text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// The renderer puts every player inside a paragraph, so the placeholder is phrasing content only
// (spans, buttons, a link; `globals.css` gives the spans their layout): a block would split it.
// `html` with every player replaced by its placeholder, unless embeds are accepted. A player whose
// address is not one of ours is dropped, and so is any iframe tag the pattern does not recognise
// (it fails closed). The attribute values are the sanitiser's, already escaped.
export function gateEmbeds(
  html: string,
  allowed: boolean,
  labels: EmbedLabels,
): string {
  if (allowed || !/<\/?iframe/i.test(html)) return html;
  const placeholders = html.replace(IFRAME, (_, attributes: string) => {
    const values: Record<string, string> = {};
    for (const match of attributes.matchAll(ATTRIBUTE))
      values[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4];
    const decode = (value: string | undefined) => value?.replace(/&amp;/g, "&");
    const src = embedSource(decode(values.src));
    if (!src) return "";
    const classes = (values.class ?? "").split(/\s+/);
    const shape = classes.includes("bb-media-audio")
      ? "audio"
      : classes.includes("bb-media-post")
        ? "post"
        : "video";
    const site = classes
      .find((name) => name.startsWith("bb-media-") && !SHAPES.has(name))
      ?.slice("bb-media-".length);
    const provider = (site && EMBED_PROVIDERS[site]) || new URL(src).hostname;
    const original = decode(values["data-media-url"]);
    const link =
      original && /^https?:\/\/[^\s"'<>]+$/.test(original)
        ? `<a class="bb-embed-link" href="${escapeText(original)}" target="_blank" rel="nofollow ugc noopener">${escapeText(labels.original)}</a>`
        : "";
    return (
      `<span class="bb-embed" data-embed-src="${escapeText(src)}" data-embed-shape="${shape}">` +
      `<span class="bb-embed-text">${escapeText(labels.hosted(provider))}</span>` +
      `<span class="bb-embed-actions">` +
      `<button type="button" class="bb-embed-button" data-embed-load>${escapeText(labels.load)}</button>` +
      `<button type="button" class="bb-embed-button bb-embed-always" data-embed-always>${escapeText(labels.always)}</button>` +
      `${link}</span></span>`
    );
  });
  return placeholders.replace(LEFTOVER, "");
}
