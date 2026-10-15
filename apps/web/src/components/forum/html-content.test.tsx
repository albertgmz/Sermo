import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { renderToReadableStream } from "react-dom/server";
import { CONSENT_COOKIE } from "@/lib/consent/inventory";
import { LITE_COOKIE } from "@/lib/lite-preferences";
import { siteBody } from "@/lib/test-bodies";
import {
  mediaHtml,
  resolveMedia,
} from "../../../../../packages/core/src/markdown/media";
import lite from "../../../messages/en/lite.json";

let cookie: string | undefined;
let consent: string | undefined;
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
  headers: async () => new Headers(),
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
  contentType: "image/png",
  byteSize: 100,
  width: 800,
  height: 400,
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
  const body = `<p>Watch</p>${player}`;
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
  }
  // A choice made under another policy version counts for nothing.
  consent = encodeURIComponent(
    JSON.stringify({ categories: ["necessary", "embeds"], revision: 2 }),
  );
  expect(await render(body)).not.toContain("<iframe");
});

test("the player is drawn once embeds are accepted", async () => {
  consent = choice("necessary", "embeds");
  const out = await render(`<p>Watch</p>${player}`);
  expect(out).toContain("<iframe");
  expect(out).toContain("youtube-nocookie.com/embed/dQw4w9WgXcQ");
  expect(out).not.toContain("data-embed-load");
});
