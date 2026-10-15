import { expect, test } from "bun:test";
import {
  MEDIA_ALLOW,
  MEDIA_IFRAME_HOSTS,
  MEDIA_SANDBOX,
  mediaHtml,
  resolveMedia,
} from "../../../../../packages/core/src/markdown/media";
import {
  EMBED_ALLOW,
  EMBED_HOSTS,
  EMBED_SANDBOX,
  embedSource,
  gateEmbeds,
} from "./embeds";

const labels = {
  hosted: (provider: string) => `Hosted by ${provider}. Load it?`,
  load: "Load",
  always: "Always",
  original: "Original",
};
const player = (site: string, id: string) => {
  const media = resolveMedia(site, id);
  if (!media) throw new Error("not a player");
  return mediaHtml(site, media);
};
const youtube = player("youtube", "dQw4w9WgXcQ");
const soundcloud = player("soundcloud", "artist/some-song");

test("the copied hosts, sandbox and permissions are the renderer's", () => {
  expect([...EMBED_HOSTS]).toEqual([...MEDIA_IFRAME_HOSTS]);
  expect(EMBED_SANDBOX).toBe(MEDIA_SANDBOX);
  expect(Object.values(EMBED_ALLOW).sort()).toEqual([...MEDIA_ALLOW].sort());
});

test("no player is emitted before the embeds category is accepted", () => {
  const html = `<p>Watch</p>${youtube}<p>and listen</p>${soundcloud}`;
  expect(html).toContain("<iframe");
  const gated = gateEmbeds(html, false, labels);
  expect(gated).not.toMatch(/<iframe/i);
  expect(gated).toContain("<p>Watch</p>");
  expect(gated).toContain("Hosted by YouTube. Load it?");
  expect(gated).toContain("Hosted by SoundCloud. Load it?");
  expect(gated).toContain(
    'data-embed-src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"',
  );
  expect(gated).toContain('href="https://www.youtube.com/watch?v=dQw4w9WgXcQ"');
  expect(gated).toContain("data-embed-load");
  expect(gated).toContain("data-embed-always");
  expect(gated.match(/class="bb-embed"/g)?.length).toBe(2);
});

test("an accepted category leaves the players as they are, and withdrawing brings the placeholders back", () => {
  expect(gateEmbeds(youtube, true, labels)).toBe(youtube);
  expect(gateEmbeds(youtube, false, labels)).not.toBe(youtube);
});

test("a player keeps its shape and a link to the original", () => {
  const audio = gateEmbeds(soundcloud, false, labels);
  expect(audio).toContain('data-embed-shape="audio"');
  expect(audio).toContain('href="https://soundcloud.com/artist/some-song"');
  expect(gateEmbeds(youtube, false, labels)).toContain(
    'data-embed-shape="video"',
  );
});

test("an iframe that is not one of the allowed players is dropped, not offered", () => {
  const foreign = `<iframe class="bb-media" src="https://evil.example/x" data-media-url="https://evil.example/x"></iframe>`;
  expect(gateEmbeds(`a${foreign}b`, false, labels)).toBe("ab");
  const plain = `<iframe src="http://www.youtube-nocookie.com/embed/x"></iframe>`;
  expect(gateEmbeds(plain, false, labels)).toBe("");
});

test("text and other elements are untouched", () => {
  const html =
    '<p>No players here, only an <a href="https://youtube.com">address</a>.</p>';
  expect(gateEmbeds(html, false, labels)).toBe(html);
});

test("only https players of the allowed hosts can be loaded", () => {
  expect(embedSource("https://player.vimeo.com/video/1")).toBe(
    "https://player.vimeo.com/video/1",
  );
  expect(embedSource("http://player.vimeo.com/video/1")).toBeNull();
  expect(
    embedSource("https://player.vimeo.com.evil.example/video/1"),
  ).toBeNull();
  expect(embedSource("javascript:alert(1)")).toBeNull();
  expect(embedSource(undefined)).toBeNull();
});

test("an iframe the pattern does not recognise is dropped, never passed through", () => {
  const odd = [
    `<iframe src="https://player.vimeo.com/video/1">`,
    `a<IFRAME src="https://player.vimeo.com/video/1"></IFRAME>b`,
    `<iframe/src="https://player.vimeo.com/video/1"></iframe>`,
    `<iframe src="https://player.vimeo.com/video/1" `,
    `x</iframe>y`,
    `<iframe\nsrc="https://player.vimeo.com/video/1"\n></iframe\n>`,
  ];
  for (const html of odd) {
    const gated = gateEmbeds(html, false, labels);
    expect(gated, html).not.toMatch(/<\/?iframe/i);
  }
  expect(gateEmbeds(odd[1] as string, false, labels)).toContain("a");
});
