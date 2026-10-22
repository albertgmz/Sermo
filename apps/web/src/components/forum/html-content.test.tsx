import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { renderToReadableStream } from "react-dom/server";
import { CONSENT_COOKIE } from "@/lib/consent/inventory";
import { LITE_COOKIE } from "@/lib/lite-preferences";
import { siteBody } from "@/lib/test-bodies";
import { blocksInParagraphs } from "@/lib/test-paragraphs";
import {
  mediaHtml,
  resolveMedia,
} from "../../../../../packages/core/src/bbcode/media";
import lite from "../../../messages/en/lite.json";

let cookie: string | undefined;
let consent: string | undefined;
let requestHost: string | undefined;
mock.module("server-only", () => ({}));
// Bun applies module mocks to the whole run, so this matches the one in the other suites.
const nextCache = await import("next/cache");
mock.module("next/cache", () => ({
  ...nextCache,
  cacheLife: () => {},
  cacheTag: () => {},
}));
mock.module("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === LITE_COOKIE && cookie !== undefined
        ? { name, value: cookie }
        : name === CONSENT_COOKIE && consent !== undefined
          ? { name, value: consent }
          : undefined,
    toString: () => (cookie === undefined ? "" : `${LITE_COOKIE}=${cookie}`),
  }),
  headers: async () =>
    new Headers(requestHost ? { host: requestHost } : undefined),
}));
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async (namespace: string) => (key: string) =>
    namespace === "lite.litePlaceholder"
      ? key === "label"
        ? lite.litePlaceholder.label
        : lite.litePlaceholder.aria.label
      : key,
}));
const { HtmlContent } = await import("./html-content");

// The site is asked for the policy version: a fake backend answers it.
const realFetch = globalThis.fetch;
beforeEach(() => {
  globalThis.fetch = (async () =>
    Response.json(siteBody())) as unknown as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  cookie = undefined;
  consent = undefined;
});

const slot = (id: number, size = "thumb") =>
  `<span class="bb-attach" data-attach-id="${id}" data-attach-size="${size}">${id}</span>`;
const picture = {
  fileId: 1,
  url: "/api/v1/files/1/cat.png",
  thumbnailUrl: "/api/v1/files/1/thumb.png",
  widths: [],
  contentType: "image/png",
  byteSize: 100,
  width: 800,
  height: 400,
  filename: "cat.png",
};

async function render(body: string, attachments = [picture]) {
  const stream = await renderToReadableStream(
    await HtmlContent({ children: body, attachments }),
  );
  await stream.allReady;
  return new Response(stream).text();
}

test("a tag becomes its attachment, and one of another item stays as text", async () => {
  cookie = undefined;
  const out = await render(`<p>${slot(1)} and ${slot(2)}</p>`);
  expect(out).toContain('src="/api/v1/files/1/thumb.png"');
  expect(out).toContain(">attachment</span>");
  expect(out).not.toContain('data-attach-id="2"');
});

test("with post pictures blocked the picture never reaches the page", async () => {
  cookie = "postImages";
  const out = await render(`<p>${slot(1, "full")}</p>`);
  expect(out).not.toContain("/api/v1/files/1");
  expect(out).toContain("lite-placeholder");
});

const choice = (...categories: string[]) =>
  encodeURIComponent(JSON.stringify({ categories, revision: 1 }));
const player = (() => {
  const media = resolveMedia("youtube", "dQw4w9WgXcQ");
  if (!media) throw new Error("not a player");
  return mediaHtml("youtube", media);
})();

test("a player is a placeholder until the embeds category is accepted", async () => {
  const body = `<p>${player}</p><p>text ${player} inline</p>`;
  for (const value of [
    undefined,
    choice("necessary"),
    choice("necessary", "analytics"),
  ]) {
    consent = value;
    const out = await render(body);
    expect(out).not.toContain("<iframe");
    expect(out).toContain("data-embed-load");
    expect(out).toContain("embedHosted");
    // The placeholder sits inside the paragraph the renderer put the player in.
    expect(blocksInParagraphs(out), out).toEqual([]);
    expect(out).toContain(" inline</p>");
  }
  // A choice made under another policy version counts for nothing.
  consent = encodeURIComponent(
    JSON.stringify({ categories: ["necessary", "embeds"], revision: 2 }),
  );
  expect(await render(body)).not.toContain("<iframe");
});

test("the player is drawn once embeds are accepted", async () => {
  consent = choice("necessary", "embeds");
  const out = await render(`<p>${player}</p>`);
  expect(out).toContain("<iframe");
  expect(out).toContain("youtube-nocookie.com/embed/dQw4w9WgXcQ");
  expect(out).not.toContain("data-embed-load");
});

test("a hashtag link in a body is drawn as the link the backend wrote, with data saver on or off", async () => {
  const body = `<p>See <a href="/tags/caf%C3%A9" class="hashtag" rel="nofollow ugc noopener">#café</a></p>`;
  for (const setting of [undefined, "all"]) {
    cookie = setting;
    const out = await render(body);
    expect(out).toContain(
      '<a href="/tags/caf%C3%A9" class="hashtag" rel="nofollow ugc noopener">#café</a>',
    );
  }
});

test("a colour typed in the body is drawn through the guard", async () => {
  const out = await render('<p><span style="color:#000">dark</span></p>');
  expect(out).toContain('class="bb-color" style="--ink:#000"');
  expect(out).not.toContain('style="color:');
});

// The wrapper that reveals spoilers: the element `HtmlContent` returns holds it under the mention
// cards, and its props are what the browser gets.
async function revealer(body: string, content = true) {
  const { SpoilerReveal } = await import("./spoiler-reveal");
  const tree = (await HtmlContent({
    children: body,
    attachments: [picture],
    content: content ? { type: "post", id: 3 } : undefined,
  })) as { props: { children: { type: unknown; props: object } } };
  const inner = tree.props.children;
  return inner.type === SpoilerReveal
    ? (inner.props as { attachments?: unknown; content: unknown })
    : null;
}

const spoiler =
  '<div class="bb-spoiler" data-spoiler="0" data-spoiler-title="t"></div>';

test("the spoiler's reveal is given the item's files, so its tags can be placed", async () => {
  const props = await revealer(`<p>${slot(1)}</p>${spoiler}`);
  expect(props?.content).toEqual({ type: "post", id: 3 });
  expect(props?.attachments).toEqual([picture]);
});

test("a body without a spoiler sends no files to the browser, and one without a content has no reveal", async () => {
  const plain = await revealer(`<p>${slot(1)}</p>`);
  expect(plain?.attachments).toBeUndefined();
  expect(await revealer(spoiler, false)).toBeNull();
});

test("a Twitch player names the configured site as its parent, whatever Host the request carries", async () => {
  const before = process.env.SERMO_PUBLIC_URL;
  process.env.SERMO_PUBLIC_URL = "https://fcuba.net";
  requestHost = "forged.example";
  consent = choice("necessary", "embeds");
  try {
    const out = await render(
      '<p><a class="bb-media-link bb-media-twitch" href="https://www.twitch.tv/somechannel">x</a></p>',
    );
    expect(out).toContain("channel=somechannel&amp;parent=fcuba.net");
    expect(out).not.toContain("forged.example");
  } finally {
    requestHost = undefined;
    if (before === undefined) delete process.env.SERMO_PUBLIC_URL;
    else process.env.SERMO_PUBLIC_URL = before;
  }
});
