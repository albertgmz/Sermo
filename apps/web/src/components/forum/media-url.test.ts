import { expect, test } from "bun:test";
import { resolveMedia } from "../../../../../packages/core/src/markdown/media";
import { mediaTagOf } from "./media-url";

const CASES: [string, string][] = [
  [
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=3",
    "[MEDIA=youtube]dQw4w9WgXcQ[/MEDIA]",
  ],
  ["https://youtu.be/dQw4w9WgXcQ?si=x", "[MEDIA=youtube]dQw4w9WgXcQ[/MEDIA]"],
  [
    "https://www.youtube.com/shorts/dQw4w9WgXcQ",
    "[MEDIA=youtube]dQw4w9WgXcQ[/MEDIA]",
  ],
  ["https://vimeo.com/76979871", "[MEDIA=vimeo]76979871[/MEDIA]"],
  ["https://player.vimeo.com/video/76979871", "[MEDIA=vimeo]76979871[/MEDIA]"],
  [
    "https://www.dailymotion.com/video/x7tgad0",
    "[MEDIA=dailymotion]x7tgad0[/MEDIA]",
  ],
  [
    "https://giphy.com/gifs/cat-funny-xT9IgzoKnwFNmISR8I",
    "[MEDIA=giphy]xT9IgzoKnwFNmISR8I[/MEDIA]",
  ],
  [
    "https://www.tiktok.com/@user/video/7106594312292453675",
    "[MEDIA=tiktok]7106594312292453675[/MEDIA]",
  ],
  [
    "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC?si=a",
    "[MEDIA=spotify]track/4uLU6hMCjMI75M1A2tKUQC[/MEDIA]",
  ],
  [
    "https://open.spotify.com/intl-es/album/4uLU6hMCjMI75M1A2tKUQC",
    "[MEDIA=spotify]album/4uLU6hMCjMI75M1A2tKUQC[/MEDIA]",
  ],
  [
    "https://soundcloud.com/artist/some-track?x=1",
    "[MEDIA=soundcloud]artist/some-track[/MEDIA]",
  ],
  [
    "https://music.apple.com/us/album/name/1234567",
    "[MEDIA=applemusic]us/album/name/1234567[/MEDIA]",
  ],
  [
    "https://bsky.app/profile/user.bsky.social/post/3k4duaz5vfs2b",
    "[MEDIA=bluesky]user.bsky.social/3k4duaz5vfs2b[/MEDIA]",
  ],
  ["https://caniuse.com/flexbox", "[MEDIA=caniuse]flexbox[/MEDIA]"],
  [
    "https://www.facebook.com/page/posts/123456",
    "[MEDIA=facebook]page/posts/123456[/MEDIA]",
  ],
  [
    "https://www.flickr.com/photos/someone/52012345678/",
    "[MEDIA=flickr]52012345678[/MEDIA]",
  ],
  ["https://imgur.com/a/abc123", "[MEDIA=imgur]a/abc123[/MEDIA]"],
  ["https://imgur.com/abc123", "[MEDIA=imgur]abc123[/MEDIA]"],
  [
    "https://www.instagram.com/p/CabcDEF123/",
    "[MEDIA=instagram]CabcDEF123[/MEDIA]",
  ],
  [
    "https://www.pinterest.com/pin/123456789/",
    "[MEDIA=pinterest]123456789[/MEDIA]",
  ],
  [
    "https://www.reddit.com/r/bun/comments/abc123/a_title/",
    "[MEDIA=reddit]r/bun/comments/abc123/a_title[/MEDIA]",
  ],
  [
    "https://someone.tumblr.com/post/123456789/slug",
    "[MEDIA=tumblr]someone/123456789[/MEDIA]",
  ],
  ["https://www.twitch.tv/somechannel", "[MEDIA=twitch]somechannel[/MEDIA]"],
  [
    "https://www.twitch.tv/videos/123456789",
    "[MEDIA=twitch]videos/123456789[/MEDIA]",
  ],
  [
    "https://twitter.com/user/status/1234567890",
    "[MEDIA=twitter]1234567890[/MEDIA]",
  ],
  ["https://x.com/user/status/1234567890", "[MEDIA=twitter]1234567890[/MEDIA]"],
];

for (const [address, expected] of CASES) {
  test(`${address} becomes ${expected}`, () => {
    expect(mediaTagOf(address)).toBe(expected);
    // The renderer accepts the id that was found.
    const [, site, id] =
      /^\[MEDIA=(\w+)\](.*)\[\/MEDIA\]$/.exec(expected) ?? [];
    expect(resolveMedia(site, id)).not.toBeNull();
  });
}

test("an address of a site that is not embedded is refused", () => {
  for (const address of [
    "https://example.com/watch?v=dQw4w9WgXcQ",
    "https://www.youtube.com/",
    "https://vimeo.com/about",
    "javascript:alert(1)",
    "not an address",
    "",
    "https://twitch.tv/videos",
  ]) {
    expect(mediaTagOf(address), address).toBeNull();
  }
});
