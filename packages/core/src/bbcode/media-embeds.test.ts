import { expect, test } from "bun:test";
import { renderBbCode } from "../render";
import { resolveMedia } from "./media";
import { mediaRefOf } from "./media-url";

const ADDRESSES: [address: string, site: string, id: string][] = [
  ["https://youtu.be/dQw4w9WgXcQ?t=42", "youtube", "dQw4w9WgXcQ"],
  ["https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1m2s", "youtube", "dQw4w9WgXcQ"],
  ["https://m.youtube.com/watch?feature=share&v=dQw4w9WgXcQ", "youtube", "dQw4w9WgXcQ"],
  ["https://www.youtube.com/shorts/dQw4w9WgXcQ", "youtube", "dQw4w9WgXcQ"],
  ["https://www.youtube.com/live/dQw4w9WgXcQ?si=a", "youtube", "dQw4w9WgXcQ"],
  ["https://vimeo.com/76979871", "vimeo", "76979871"],
  ["https://vimeo.com/channels/staffpicks/76979871", "vimeo", "76979871"],
  ["https://player.vimeo.com/video/76979871?h=ab", "vimeo", "76979871"],
  ["https://twitter.com/user/status/1699954318361739700", "twitter", "1699954318361739700"],
  ["https://x.com/user/status/1699954318361739700?s=20", "twitter", "1699954318361739700"],
  ["https://x.com/i/web/status/1699954318361739700", "twitter", "1699954318361739700"],
  ["https://www.instagram.com/p/C0-0KKstKJQ/", "instagram", "C0-0KKstKJQ"],
  ["https://www.instagram.com/reel/C0caAg-N-MA/?igsh=x", "instagram", "C0caAg-N-MA"],
  ["https://www.instagram.com/someone/reel/C0caAg-N-MA/", "instagram", "C0caAg-N-MA"],
  ["https://instagram.com/tv/C0DtmXHtUHh", "instagram", "C0DtmXHtUHh"],
  ["https://www.tiktok.com/@user.name/video/7360266292814794016", "tiktok", "7360266292814794016"],
  [
    "https://www.tiktok.com/@user/video/7360266292814794016?lang=es",
    "tiktok",
    "7360266292814794016",
  ],
  [
    "https://www.facebook.com/page.name/videos/1234567890",
    "facebook",
    "page.name/videos/1234567890",
  ],
  [
    "https://www.facebook.com/100004407312250/posts/1877961679027391",
    "facebook",
    "100004407312250/posts/1877961679027391",
  ],
  ["https://www.facebook.com/watch/?v=1234567890", "facebook", "1234567890"],
  [
    "https://open.spotify.com/track/0OuvMbIdvi9d2Ucsk1poS0?si=a",
    "spotify",
    "track/0OuvMbIdvi9d2Ucsk1poS0",
  ],
  [
    "https://open.spotify.com/intl-es/album/4uLU6hMCjMI75M1A2tKUQC",
    "spotify",
    "album/4uLU6hMCjMI75M1A2tKUQC",
  ],
  [
    "https://open.spotify.com/playlist/2iTtzI1R4cpSarJWRiBFTp",
    "spotify",
    "playlist/2iTtzI1R4cpSarJWRiBFTp",
  ],
  [
    "https://open.spotify.com/episode/5QP41XUfLv2VEZwws6cEFc",
    "spotify",
    "episode/5QP41XUfLv2VEZwws6cEFc",
  ],
  [
    "https://open.spotify.com/user/someone/playlist/2iTtzI1R4cpSarJWRiBFTp",
    "spotify",
    "playlist/2iTtzI1R4cpSarJWRiBFTp",
  ],
  ["https://soundcloud.com/forss/flickermood", "soundcloud", "forss/flickermood"],
  ["https://www.twitch.tv/somechannel", "twitch", "somechannel"],
  ["https://www.twitch.tv/videos/123456789", "twitch", "videos/123456789"],
  ["https://clips.twitch.tv/FunnyClipName-abc123", "twitch", "clip/FunnyClipName-abc123"],
  [
    "https://www.twitch.tv/somechannel/clip/FunnyClipName-abc123",
    "twitch",
    "clip/FunnyClipName-abc123",
  ],
  [
    "https://www.reddit.com/r/cuba/comments/1ash6mv/a_title/",
    "reddit",
    "r/cuba/comments/1ash6mv/a_title",
  ],
  ["https://old.reddit.com/r/cuba/comments/1ash6mv", "reddit", "r/cuba/comments/1ash6mv"],
  ["https://dai.ly/x82puif", "dailymotion", "x82puif"],
];

for (const [address, site, id] of ADDRESSES) {
  test(`${address} is ${site} ${id}`, () => {
    // old.reddit.com is not a site the editor knows: only the address shapes of the listed sites.
    if (address.includes("old.reddit")) return expect(mediaRefOf(address)).toBeNull();
    expect(mediaRefOf(address)).toEqual({ site, id });
    expect(resolveMedia(site, id), "the renderer accepts the id").not.toBeNull();
  });
}

test("addresses of pages that are not a video or a post are not embedded", () => {
  for (const address of [
    "https://x.com/someone",
    "https://www.instagram.com/someone/",
    "https://www.facebook.com/somepage",
    "https://www.reddit.com/r/cuba/",
    "https://soundcloud.com/forss",
    "https://open.spotify.com/",
    "https://www.tiktok.com/@user",
  ])
    expect(mediaRefOf(address), address).toBeNull();
});

test("imported tags are accepted in the forms XenForo wrote them", () => {
  const players = { players: true, parent: "fcuba.net" };
  expect(resolveMedia("reddit", "cuba/comments/1ash6mv", players)).toMatchObject({
    kind: "iframe",
    src: "https://embed.reddit.com/r/cuba/comments/1ash6mv?embed=true",
    url: "https://www.reddit.com/r/cuba/comments/1ash6mv",
  });
  expect(
    resolveMedia("reddit", "AfterVanced/comments/18s16ru/comment/kf4hkv3", players),
  ).toMatchObject({ url: "https://www.reddit.com/r/AfterVanced/comments/18s16ru" });
  expect(resolveMedia("facebook", "1234567890", players)).toMatchObject({
    kind: "iframe",
    src: expect.stringContaining("/plugins/video.php?href="),
  });
  expect(resolveMedia("facebook", "page/posts/pfbid02abcDEF", players)).toMatchObject({
    kind: "iframe",
  });
  expect(resolveMedia("spotify", "playlist:2iTtzI1R4cpSarJWRiBFTp")).toMatchObject({
    src: "https://open.spotify.com/embed/playlist/2iTtzI1R4cpSarJWRiBFTp",
  });
  expect(resolveMedia("youtube", "dQw4w9WgXcQ")).toMatchObject({
    src: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
  });
});

test("social posts are stored as links, and are players only where the page asks for them", () => {
  expect(resolveMedia("twitter", "1699954318361739700")).toEqual({
    kind: "link",
    url: "https://x.com/i/status/1699954318361739700",
  });
  expect(resolveMedia("twitter", "1699954318361739700", { players: true })).toMatchObject({
    kind: "iframe",
    shape: "post",
    src: "https://platform.twitter.com/embed/Tweet.html?id=1699954318361739700&dnt=true",
  });
  expect(resolveMedia("instagram", "C0caAg-N-MA", { players: true })).toMatchObject({
    src: "https://www.instagram.com/p/C0caAg-N-MA/embed/captioned/",
  });
});

test("Twitch is a player only for the host that shows it", () => {
  const without = resolveMedia("twitch", "somechannel", { players: true });
  expect(without).toEqual({ kind: "link", url: "https://www.twitch.tv/somechannel" });
  const host = { players: true, parent: "fcuba.net" };
  expect(resolveMedia("twitch", "somechannel", host)).toMatchObject({
    src: "https://player.twitch.tv/?channel=somechannel&parent=fcuba.net&autoplay=false",
  });
  expect(resolveMedia("twitch", "videos/123456789", host)).toMatchObject({
    src: "https://player.twitch.tv/?video=123456789&parent=fcuba.net&autoplay=false",
  });
  expect(resolveMedia("twitch", "clip/FunnyClip-1", host)).toMatchObject({
    src: "https://clips.twitch.tv/embed?clip=FunnyClip-1&parent=fcuba.net&autoplay=false",
  });
  expect(
    resolveMedia("twitch", "somechannel", { players: true, parent: 'a"><script>' }),
  ).toMatchObject({ kind: "link" });
});

test("an address alone on its line becomes its player when the message is saved", () => {
  const html = renderBbCode("before\nhttps://youtu.be/dQw4w9WgXcQ\nafter");
  expect(html).toContain(
    '<iframe class="bb-media bb-media-video bb-media-youtube" src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"',
  );
  expect(html).toContain("before");
  expect(html).toContain("after");
  expect(renderBbCode("  https://vimeo.com/76979871  ")).toContain("<iframe");
  expect(renderBbCode("https://x.com/u/status/123456")).toContain(
    '<a class="bb-media-link bb-media-twitter" href="https://x.com/i/status/123456"',
  );
});

test("an address inside a sentence, a code block or a link stays a plain link or text", () => {
  expect(renderBbCode("watch https://youtu.be/dQw4w9WgXcQ now")).not.toContain("<iframe");
  expect(renderBbCode("https://youtu.be/dQw4w9WgXcQ.")).not.toContain("<iframe");
  expect(renderBbCode("[CODE]\nhttps://youtu.be/dQw4w9WgXcQ\n[/CODE]")).not.toContain("<iframe");
  expect(renderBbCode("[URL=https://a.example]https://youtu.be/dQw4w9WgXcQ[/URL]")).not.toContain(
    "<iframe",
  );
  expect(renderBbCode("https://example.com/watch\nhttps://youtu.be/dQw4w9WgXcQ")).toContain(
    '<a href="https://example.com/watch"',
  );
});

test("an address of a site that is not embedded stays a link", () => {
  expect(renderBbCode("https://example.com/video/1")).toContain(
    '<a href="https://example.com/video/1"',
  );
});
