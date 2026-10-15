import { escapeHtml } from "./escape";

/**
 * [MEDIA=site]id[/MEDIA]: every provider id is validated against a fixed pattern and the embed or
 * link address is built here from the validated parts; nothing the author typed is copied into a
 * URL. Providers with a plain iframe player render an iframe; the others (their embeds need the
 * provider's own script, or a page address we cannot know) render a link to the canonical page.
 */
type Resolved =
  | { kind: "iframe"; src: string; url: string; allow: string; shape: "video" | "audio" }
  | { kind: "link"; url: string };

const VIDEO_ALLOW = "fullscreen; picture-in-picture";
const AUDIO_ALLOW = "encrypted-media; fullscreen";

function video(src: string, url: string): Resolved {
  return { kind: "iframe", src, url, allow: VIDEO_ALLOW, shape: "video" };
}
function audio(src: string, url: string): Resolved {
  return { kind: "iframe", src, url, allow: AUDIO_ALLOW, shape: "audio" };
}
const link = (url: string): Resolved => ({ kind: "link", url });

/** The hosts an embedded player is served from: the iframe allowlist of the sanitizer. */
export const MEDIA_IFRAME_HOSTS = [
  "www.youtube-nocookie.com",
  "player.vimeo.com",
  "www.dailymotion.com",
  "open.spotify.com",
  "w.soundcloud.com",
  "embed.music.apple.com",
  "giphy.com",
  "www.tiktok.com",
] as const;

export const MEDIA_SANDBOX = "allow-scripts allow-same-origin allow-presentation allow-popups";
export const MEDIA_ALLOW = [VIDEO_ALLOW, AUDIO_ALLOW];

const providers: Record<string, (id: string) => Resolved | null> = {
  youtube(id) {
    if (!/^[\w-]{11}$/.test(id)) return null;
    return video(
      `https://www.youtube-nocookie.com/embed/${id}`,
      `https://www.youtube.com/watch?v=${id}`,
    );
  },
  vimeo(id) {
    if (!/^\d{1,12}$/.test(id)) return null;
    return video(`https://player.vimeo.com/video/${id}`, `https://vimeo.com/${id}`);
  },
  dailymotion(id) {
    if (!/^[a-z0-9]{4,20}$/i.test(id)) return null;
    return video(
      `https://www.dailymotion.com/embed/video/${id}`,
      `https://www.dailymotion.com/video/${id}`,
    );
  },
  giphy(id) {
    if (!/^[A-Za-z0-9]{5,30}$/.test(id)) return null;
    return video(`https://giphy.com/embed/${id}`, `https://giphy.com/gifs/${id}`);
  },
  tiktok(id) {
    if (!/^\d{10,25}$/.test(id)) return null;
    return video(`https://www.tiktok.com/embed/v2/${id}`, `https://www.tiktok.com/@/video/${id}`);
  },
  spotify(id) {
    const match = /^(track|album|playlist|episode|show|artist)[:/]([A-Za-z0-9]{22})$/.exec(id);
    if (!match) return null;
    return audio(
      `https://open.spotify.com/embed/${match[1]}/${match[2]}`,
      `https://open.spotify.com/${match[1]}/${match[2]}`,
    );
  },
  soundcloud(id) {
    const match = /^([\w-]{1,60})\/([\w-]{1,120})$/.exec(id);
    if (!match) return null;
    const page = `https://soundcloud.com/${match[1]}/${match[2]}`;
    return audio(`https://w.soundcloud.com/player/?url=${encodeURIComponent(page)}`, page);
  },
  applemusic(id) {
    const match =
      /^([a-z]{2})\/(album|playlist|song|station)\/([\w%.-]{1,120})(?:\/([\w.-]{1,40}))?$/.exec(id);
    if (!match) return null;
    const path = `${match[1]}/${match[2]}/${match[3]}${match[4] ? `/${match[4]}` : ""}`;
    return audio(`https://embed.music.apple.com/${path}`, `https://music.apple.com/${path}`);
  },
  bluesky(id) {
    const match =
      /^((?:did:plc:[a-z0-9]{10,40})|(?:[A-Za-z0-9][A-Za-z0-9.-]{0,252}))\/([A-Za-z0-9]{6,20})$/.exec(
        id,
      );
    if (!match) return null;
    return link(`https://bsky.app/profile/${match[1]}/post/${match[2]}`);
  },
  caniuse(id) {
    if (!/^[a-z0-9-]{1,60}$/.test(id)) return null;
    return link(`https://caniuse.com/${id}`);
  },
  facebook(id) {
    if (!/^[\w.-]{1,80}\/(?:posts|videos)\/\d{1,25}$/.test(id)) return null;
    return link(`https://www.facebook.com/${id}`);
  },
  flickr(id) {
    if (!/^\d{1,20}$/.test(id)) return null;
    return link(`https://www.flickr.com/photo.gne?id=${id}`);
  },
  imgur(id) {
    if (!/^(?:(?:a|gallery)\/)?[A-Za-z0-9]{3,12}$/.test(id)) return null;
    return link(`https://imgur.com/${id}`);
  },
  instagram(id) {
    if (!/^[\w-]{5,30}$/.test(id)) return null;
    return link(`https://www.instagram.com/p/${id}/`);
  },
  pinterest(id) {
    if (!/^\d{1,25}$/.test(id)) return null;
    return link(`https://www.pinterest.com/pin/${id}/`);
  },
  reddit(id) {
    if (!/^r\/\w{2,30}\/comments\/[a-z0-9]{3,12}(?:\/[\w-]{1,100})?$/i.test(id)) return null;
    return link(`https://www.reddit.com/${id}`);
  },
  tumblr(id) {
    const match = /^([a-z0-9-]{1,60})\/(\d{1,25})$/i.exec(id);
    if (!match) return null;
    return link(`https://${match[1]!.toLowerCase()}.tumblr.com/post/${match[2]}`);
  },
  twitch(id) {
    if (/^[A-Za-z0-9_]{3,25}$/.test(id)) return link(`https://www.twitch.tv/${id}`);
    const videoId = /^videos?[:/](\d{1,15})$/.exec(id);
    return videoId ? link(`https://www.twitch.tv/videos/${videoId[1]}`) : null;
  },
  twitter(id) {
    if (!/^\d{1,25}$/.test(id)) return null;
    return link(`https://x.com/i/status/${id}`);
  },
};
providers.x = providers.twitter!;

export function resolveMedia(site: string, id: string): Resolved | null {
  const provider = Object.hasOwn(providers, site) ? providers[site] : undefined;
  return provider ? provider(id) : null;
}

const SHAPE_CLASS = { video: "bb-media-video", audio: "bb-media-audio" };

export function mediaHtml(site: string, media: Resolved): string {
  const url = escapeHtml(media.url);
  if (media.kind === "link")
    return `<a class="bb-media-link bb-media-${site}" href="${url}">${url}</a>`;
  return (
    `<iframe class="bb-media ${SHAPE_CLASS[media.shape]} bb-media-${site}" src="${escapeHtml(media.src)}" ` +
    `loading="lazy" sandbox="${MEDIA_SANDBOX}" allow="${media.allow}" ` +
    `referrerpolicy="strict-origin-when-cross-origin" allowfullscreen data-media-url="${url}"></iframe>`
  );
}
