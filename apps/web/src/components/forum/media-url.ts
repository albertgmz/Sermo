// The BB code tag for the address of a video, song, post or picture page of a site the renderer
// embeds (`[MEDIA=site]id[/MEDIA]`), or null for any other address. The renderer checks the id
// again; this only finds it in the address.
const tag = (site: string, id: string | undefined) =>
  id ? `[MEDIA=${site}]${id}[/MEDIA]` : null;

type Reader = (parts: string[], url: URL) => string | null;

const after = (parts: string[], word: string) => {
  const at = parts.indexOf(word);
  return at < 0 ? undefined : parts[at + 1];
};

const youtube: Reader = (parts, url) =>
  tag(
    "youtube",
    url.searchParams.get("v") ??
      (["embed", "shorts", "live", "v"].includes(parts[0])
        ? parts[1]
        : undefined),
  );

const READERS: Record<string, Reader> = {
  "youtube.com": youtube,
  "youtube-nocookie.com": youtube,
  "youtu.be": (parts) => tag("youtube", parts[0]),
  "vimeo.com": (parts) =>
    tag(
      "vimeo",
      parts.find((p) => /^\d+$/.test(p)),
    ),
  "dailymotion.com": (parts) =>
    tag("dailymotion", after(parts, "video")?.split("_")[0]),
  "dai.ly": (parts) => tag("dailymotion", parts[0]),
  "giphy.com": (parts) => {
    const last = parts[0] === "gifs" ? parts[1]?.split("-").at(-1) : parts[1];
    return tag("giphy", last);
  },
  "tiktok.com": (parts) => tag("tiktok", after(parts, "video")),
  "open.spotify.com": (parts) => {
    const [kind, id] = parts[0]?.startsWith("intl-") ? parts.slice(1) : parts;
    return id ? tag("spotify", `${kind}/${id}`) : null;
  },
  "soundcloud.com": (parts) =>
    parts.length >= 2 ? tag("soundcloud", `${parts[0]}/${parts[1]}`) : null,
  "music.apple.com": (parts) =>
    parts.length >= 3 ? tag("applemusic", parts.slice(0, 4).join("/")) : null,
  "bsky.app": (parts) =>
    parts[0] === "profile" && parts[2] === "post"
      ? tag("bluesky", `${parts[1]}/${parts[3]}`)
      : null,
  "caniuse.com": (parts, url) =>
    tag("caniuse", url.searchParams.get("feat") ?? parts[0]),
  "facebook.com": (parts) =>
    parts.length >= 3 && ["posts", "videos"].includes(parts[1])
      ? tag("facebook", parts.slice(0, 3).join("/"))
      : null,
  "flickr.com": (parts) =>
    parts[0] === "photos" ? tag("flickr", parts[2]) : null,
  "imgur.com": (parts) =>
    tag(
      "imgur",
      ["a", "gallery"].includes(parts[0])
        ? parts.slice(0, 2).join("/")
        : parts[0],
    ),
  "instagram.com": (parts) =>
    parts[0] === "p" ? tag("instagram", parts[1]) : null,
  "pinterest.com": (parts) =>
    parts[0] === "pin" ? tag("pinterest", parts[1]) : null,
  "reddit.com": (parts) =>
    parts[0] === "r" && parts[2] === "comments"
      ? tag("reddit", parts.slice(0, 5).join("/"))
      : null,
  "twitch.tv": (parts) =>
    parts[0] === "videos"
      ? tag("twitch", parts[1] && `videos/${parts[1]}`)
      : tag("twitch", parts[0]),
  "twitter.com": (parts) =>
    parts[1] === "status" ? tag("twitter", parts[2]) : null,
  "x.com": (parts) => (parts[1] === "status" ? tag("twitter", parts[2]) : null),
};

export function mediaTagOf(address: string): string | null {
  let url: URL;
  try {
    url = new URL(address.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname
    .toLowerCase()
    .replace(/^(www|m|mobile|player)\./, "");
  const parts = url.pathname.split("/").filter(Boolean);
  if (host.endsWith(".tumblr.com")) {
    return parts[0] === "post"
      ? tag("tumblr", `${host.slice(0, -".tumblr.com".length)}/${parts[1]}`)
      : null;
  }
  return READERS[host]?.(parts, url) ?? null;
}
