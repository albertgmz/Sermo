// The site and id of the address of a video, song, post or picture page of a site the renderer
// embeds (`[MEDIA=site]id[/MEDIA]`), or null for any other address. The renderer checks the id
// again; this only finds it in the address. Pure and import-free: the editor uses it too.
export interface MediaRef {
  site: string;
  id: string;
}

const tag = (site: string, id: string | undefined): MediaRef | null => (id ? { site, id } : null);

type Reader = (parts: string[], url: URL) => MediaRef | null;

const after = (parts: string[], word: string) => {
  const at = parts.indexOf(word);
  return at < 0 ? undefined : parts[at + 1];
};

const youtube: Reader = (parts, url) =>
  tag(
    "youtube",
    url.searchParams.get("v") ??
      (["embed", "shorts", "live", "v"].includes(parts[0] ?? "") ? parts[1] : undefined),
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
  "dailymotion.com": (parts) => tag("dailymotion", after(parts, "video")?.split("_")[0]),
  "dai.ly": (parts) => tag("dailymotion", parts[0]),
  "giphy.com": (parts) => {
    const last = parts[0] === "gifs" ? parts[1]?.split("-").at(-1) : parts[1];
    return tag("giphy", last);
  },
  "tiktok.com": (parts) => tag("tiktok", after(parts, "video")),
  "open.spotify.com": (parts) => {
    const at = parts.findIndex((p) =>
      ["track", "album", "playlist", "episode", "show", "artist"].includes(p),
    );
    return at < 0 || !parts[at + 1] ? null : tag("spotify", `${parts[at]}/${parts[at + 1]}`);
  },
  "soundcloud.com": (parts) =>
    parts.length >= 2 ? tag("soundcloud", `${parts[0]}/${parts[1]}`) : null,
  "music.apple.com": (parts) =>
    parts.length >= 3 ? tag("applemusic", parts.slice(0, 4).join("/")) : null,
  "bsky.app": (parts) =>
    parts[0] === "profile" && parts[2] === "post"
      ? tag("bluesky", `${parts[1]}/${parts[3]}`)
      : null,
  "caniuse.com": (parts, url) => tag("caniuse", url.searchParams.get("feat") ?? parts[0]),
  "facebook.com": (parts, url) => {
    if (parts.length >= 3 && ["posts", "videos"].includes(parts[1] ?? ""))
      return tag("facebook", parts.slice(0, 3).join("/"));
    const watched = url.searchParams.get("v");
    const isVideo = parts[0] === "watch" || parts[0] === "video.php";
    return isVideo && watched && /^\d+$/.test(watched) ? tag("facebook", watched) : null;
  },
  "flickr.com": (parts) => (parts[0] === "photos" ? tag("flickr", parts[2]) : null),
  "imgur.com": (parts) =>
    tag(
      "imgur",
      ["a", "gallery"].includes(parts[0] ?? "") ? parts.slice(0, 2).join("/") : parts[0],
    ),
  "instagram.com": (parts) => {
    // The address may start with the account (`/user/reel/<id>`).
    const at = parts.findIndex((p, i) => i < 2 && ["p", "reel", "tv"].includes(p));
    return at < 0 ? null : tag("instagram", parts[at + 1]);
  },
  "pinterest.com": (parts) => (parts[0] === "pin" ? tag("pinterest", parts[1]) : null),
  "reddit.com": (parts) =>
    parts[0] === "r" && parts[2] === "comments" ? tag("reddit", parts.slice(0, 5).join("/")) : null,
  "twitch.tv": (parts) =>
    parts[0] === "videos"
      ? tag("twitch", parts[1] && `videos/${parts[1]}`)
      : parts[1] === "clip"
        ? tag("twitch", parts[2] && `clip/${parts[2]}`)
        : tag("twitch", parts[0]),
  "clips.twitch.tv": (parts) => tag("twitch", parts[0] && `clip/${parts[0]}`),
  "twitter.com": (parts) => tag("twitter", after(parts, "status") ?? after(parts, "statuses")),
  "x.com": (parts) => tag("twitter", after(parts, "status") ?? after(parts, "statuses")),
};

export function mediaRefOf(address: string): MediaRef | null {
  let url: URL;
  try {
    url = new URL(address.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase().replace(/^(www|m|mobile|player)\./, "");
  const parts = url.pathname.split("/").filter(Boolean);
  if (host.endsWith(".tumblr.com")) {
    return parts[0] === "post"
      ? tag("tumblr", `${host.slice(0, -".tumblr.com".length)}/${parts[1]}`)
      : null;
  }
  return READERS[host]?.(parts, url) ?? null;
}

export function mediaTagOf(address: string): string | null {
  const media = mediaRefOf(address);
  return media ? `[MEDIA=${media.site}]${media.id}[/MEDIA]` : null;
}
