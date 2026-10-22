import { expect, test } from "bun:test";
import { renderBbCode } from "../../../../packages/core/src/render";
import { EMBED_HOSTS, gateEmbeds } from "./consent/embeds";
import { stripHtmlMedia } from "./lite-content";
import { withMediaPlayers } from "./media-links";
import { contentSecurityPolicy } from "./security-headers";

const labels = {
  hosted: (provider: string) => `From ${provider}`,
  load: "Load",
  always: "Always",
  original: "Original",
};
// What the backend stores for a message whose only content is the address.
const stored = (address: string) => renderBbCode(address);
const FORUM = "https://fcuba.net";

const PLAYERS: [address: string, src: string, provider: string][] = [
  [
    "https://x.com/user/status/1699954318361739700",
    "https://platform.twitter.com/embed/Tweet.html?id=1699954318361739700&amp;dnt=true",
    "X",
  ],
  [
    "https://www.instagram.com/reel/C0caAg-N-MA/",
    "https://www.instagram.com/p/C0caAg-N-MA/embed/captioned/",
    "Instagram",
  ],
  [
    "https://www.facebook.com/page/posts/1234567",
    "https://www.facebook.com/plugins/post.php?href=https%3A%2F%2Fwww.facebook.com%2Fpage%2Fposts%2F1234567&amp;show_text=true&amp;width=500",
    "Facebook",
  ],
  [
    "https://www.reddit.com/r/cuba/comments/1ash6mv/a_title/",
    "https://embed.reddit.com/r/cuba/comments/1ash6mv/a_title/?embed=true",
    "Reddit",
  ],
  [
    "https://www.twitch.tv/videos/123456789",
    "https://player.twitch.tv/?video=123456789&amp;parent=fcuba.net&amp;autoplay=false",
    "Twitch",
  ],
  [
    "https://clips.twitch.tv/FunnyClip-1",
    "https://clips.twitch.tv/embed?clip=FunnyClip-1&amp;parent=fcuba.net&amp;autoplay=false",
    "Twitch",
  ],
];

for (const [address, src, provider] of PLAYERS) {
  test(`a stored link to ${address} is shown as ${provider}'s player, held back until accepted`, () => {
    const html = stored(address);
    expect(html).not.toContain("<iframe");
    const shown = withMediaPlayers(html, FORUM);
    expect(shown).toContain(`src="${src}"`);
    // Nothing loads before the visitor accepts: only a placeholder with the address as data.
    const gated = gateEmbeds(shown, false, labels);
    expect(gated).not.toMatch(/<iframe/i);
    expect(gated).toContain(`From ${provider}`);
    expect(gated).toContain(
      `data-embed-src="${src.replaceAll("&amp;", "&#38;")}"`,
    );
    // The link to the page is the canonical one, whatever shape the address had.
    expect(gated).toContain('class="bb-embed-link" href="https://');
  });
}

test("a tweet or post is drawn in the tall frame", () => {
  const gated = gateEmbeds(
    withMediaPlayers(stored("https://x.com/u/status/12345"), FORUM),
    false,
    labels,
  );
  expect(gated).toContain('data-embed-shape="post"');
});

test("Twitch stays a link when the host is not known, and other links are left alone", () => {
  const twitch = stored("https://www.twitch.tv/somechannel");
  expect(withMediaPlayers(twitch, undefined)).toBe(twitch);
  const other =
    '<p><a href="https://example.com/x">x</a> <a class="bb-media-link bb-media-imgur" href="https://imgur.com/abc123">https://imgur.com/abc123</a></p>';
  expect(withMediaPlayers(other, FORUM)).toBe(other);
  expect(withMediaPlayers("<p>plain</p>", FORUM)).toBe("<p>plain</p>");
});

test("a link whose address is of another site than its class is not made a player", () => {
  const html =
    '<p><a class="bb-media-link bb-media-twitter" href="https://evil.example/i/status/1">x</a></p>';
  expect(withMediaPlayers(html, FORUM)).toBe(html);
});

test("no more players than a message may hold", () => {
  const html = stored("https://x.com/u/status/12345\n").repeat(60);
  expect(withMediaPlayers(html, FORUM).match(/<iframe/g)).toHaveLength(50);
});

test("LITE mode with everything blocked leaves a link and no player", () => {
  const shown = withMediaPlayers(stored("https://x.com/u/status/12345"), FORUM);
  const lite = stripHtmlMedia(shown, { master: true, blocked: [] });
  expect(lite).not.toContain("<iframe");
  expect(lite).toContain('href="https://x.com/i/status/12345"');
});

test("the policy lets exactly these frames in, and no script origin is added", () => {
  const policy = contentSecurityPolicy({
    nonce: "bm9uY2U=",
    https: true,
    publicUrl: "https://fcuba.net",
    analytics: { provider: "none" },
    development: false,
  });
  const frames = policy.split("; ").find((d) => d.startsWith("frame-src "));
  for (const host of [
    "platform.twitter.com",
    "www.instagram.com",
    "www.facebook.com",
    "embed.reddit.com",
    "player.twitch.tv",
    "clips.twitch.tv",
    "www.youtube-nocookie.com",
    "open.spotify.com",
    "w.soundcloud.com",
    "player.vimeo.com",
    "www.dailymotion.com",
    "www.tiktok.com",
  ]) {
    expect(frames, host).toContain(`https://${host}`);
    expect(EMBED_HOSTS).toContain(host);
  }
  const scripts = policy.split("; ").find((d) => d.startsWith("script-src "));
  expect(scripts).toBe("script-src 'self' 'nonce-bm9uY2U=' 'strict-dynamic'");
});

test("a link stored under the name x is shown as the tweet's player", () => {
  const html =
    '<p><a class="bb-media-link bb-media-x" href="https://x.com/i/status/12345">x</a></p>';
  expect(withMediaPlayers(html, FORUM)).toContain(
    "https://platform.twitter.com/embed/Tweet.html?id=12345",
  );
});
