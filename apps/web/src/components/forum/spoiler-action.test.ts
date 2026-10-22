import { afterEach, expect, mock, test } from "bun:test";
import { CONSENT_COOKIE } from "@/lib/consent/inventory";
import { serializeLiteCookie } from "@/lib/lite-preferences";
import { siteBody } from "@/lib/test-bodies";
import { translator } from "@/lib/test-intl";
import { blocksInParagraphs } from "@/lib/test-paragraphs";

// Only the request and the network are stood in for; the client, the LITE filter and the contract
// are the real ones.
let cookie = "";
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
  headers: async () => new Headers(),
  cookies: async () => ({
    set: () => {},
    get: (name: string) =>
      name === CONSENT_COOKIE && consent !== undefined
        ? { name, value: consent }
        : undefined,
    toString: () => cookie,
  }),
}));
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async (namespace: string) => translator(namespace),
}));
const { revealSpoiler } = await import("./spoiler-action");

const realFetch = globalThis.fetch;
const urls: string[] = [];
function backend(response: () => Response) {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    // The site is asked for too (the cookie policy version), when a player has to be gated.
    if (String(input).includes("/site")) return Response.json(siteBody());
    // And the smilies, which the spoiler's text is shown with.
    if (String(input).includes("/smilies"))
      return Response.json({
        items: [{ id: 17, title: "Laugh", codes: [":LOL:"], emoji: "😆" }],
      });
    urls.push(String(input));
    return response();
  }) as unknown as typeof fetch;
}
afterEach(() => {
  globalThis.fetch = realFetch;
  cookie = "";
  consent = undefined;
  urls.length = 0;
});

test("asks the backend for the spoiler and returns it with buttons for the ones inside", async () => {
  backend(() =>
    Response.json({
      html: 'secret <span class="bb-spoiler bb-spoiler-inline" data-spoiler="2"></span>',
    }),
  );
  const result = await revealSpoiler("post", 5, 1);
  expect(urls).toHaveLength(1);
  expect(urls[0]).toContain("/spoilers?");
  expect(urls[0]).toContain("contentType=post");
  expect(urls[0]).toContain("contentId=5");
  expect(urls[0]).toContain("position=1");
  expect(result?.html).toContain("secret ");
  expect(result?.html).toContain(
    '<button type="button" class="bb-spoiler-button"',
  );
  expect(result?.html).not.toContain("disabled");
});

test("the returned HTML is filtered like a body with the Data saver on", async () => {
  const html =
    '<p>x <img src="https://pictures.test/a.png"> y</p><iframe src="https://player.vimeo.com/video/1" data-media-url="https://vimeo.com/1"></iframe>';
  backend(() => Response.json({ html }));
  cookie = `forum_lite=${serializeLiteCookie({ master: false, blocked: ["postImages"] })}`;
  const lite = await revealSpoiler("profile_post", 1, 0);
  expect(lite?.html).not.toContain("<img");
  expect(lite?.html).not.toContain("<iframe");
  expect(lite?.html).toContain("DATA SAVER");
  expect(lite?.html).toContain('<a href="https://vimeo.com/1"');
  cookie = "";
  expect((await revealSpoiler("profile_post", 1, 0))?.html).toContain("<img");
});

test("input the contract does not accept never reaches the backend", async () => {
  backend(() => Response.json({ html: "x" }));
  for (const [type, id, position] of [
    ["thread", 1, 0],
    ["post", 0, 0],
    ["post", -3, 0],
    ["post", 1.5, 0],
    ["post", 1, -1],
    ["post", 1, 1000],
    ["post", Number.NaN, 0],
    ["../x", 1, 0],
  ] as const)
    expect(await revealSpoiler(type, id, position)).toBeNull();
  expect(urls).toEqual([]);
});

test("a refusal gives null and any other failure is raised", async () => {
  backend(() =>
    Response.json(
      { error: { code: "not_found", message: "No." } },
      { status: 404 },
    ),
  );
  expect(await revealSpoiler("post", 1, 0)).toBeNull();
  globalThis.fetch = (async () => {
    throw new TypeError("network");
  }) as unknown as typeof fetch;
  const outcome = await revealSpoiler("post", 1, 0).then(
    (value) => ({ value }),
    (error) => ({ error }),
  );
  // A transport failure is a SermoError too (the backend could not be reached): no spoiler.
  expect("error" in outcome ? outcome.error : outcome.value).toBeDefined();
});

const voteFrame =
  '<iframe class="bb-media bb-media-video bb-media-vimeo" src="https://player.vimeo.com/video/1" data-media-url="https://vimeo.com/1"></iframe>';
const choice = (...categories: string[]) =>
  encodeURIComponent(JSON.stringify({ categories, revision: 1 }));

test("a player inside a spoiler is a placeholder until the embeds category is accepted", async () => {
  // The same backend answers the spoiler and the site (asked for the policy version).
  globalThis.fetch = (async (input: RequestInfo | URL) =>
    String(input).includes("/spoilers?")
      ? Response.json({ html: `<p>secret</p><p>${voteFrame}</p>` })
      : Response.json(siteBody())) as unknown as typeof fetch;
  for (const value of [
    undefined,
    choice("necessary"),
    choice("necessary", "analytics"),
  ]) {
    consent = value;
    const hidden = await revealSpoiler("post", 5, 1);
    expect(hidden?.html).not.toContain("<iframe");
    expect(hidden?.html).toContain("data-embed-load");
    expect(hidden?.html).toContain("<p>secret</p>");
    expect(blocksInParagraphs(hidden?.html ?? ""), hidden?.html).toEqual([]);
  }
  consent = choice("necessary", "embeds");
  const shown = await revealSpoiler("post", 5, 1);
  expect(shown?.html).toContain("<iframe");
  expect(shown?.html).not.toContain("data-embed-load");
});

const slot = (id: number, size: "thumb" | "full" = "thumb") =>
  `<span class="bb-attach" data-attach-id="${id}" data-attach-size="${size}">${id}</span>`;
const file = (fileId: number, over: Record<string, unknown> = {}) => ({
  fileId,
  url: `/api/v1/files/${fileId}`,
  thumbnailUrl: `/api/v1/files/${fileId}1`,
  widths: [],
  contentType: "image/png",
  byteSize: 2048,
  width: 1000,
  height: 500,
  filename: "plan.png",
  ...over,
});

test("an attachment tag inside a spoiler is drawn from the item's files, and a missing one is a label", async () => {
  backend(() =>
    Response.json({ html: `<p>${slot(4, "full")} ${slot(9)}</p>` }),
  );
  const result = await revealSpoiler("post", 5, 0, [file(4)]);
  expect(result?.html).toContain('src="/api/v1/files/4"');
  expect(result?.html).not.toContain("bb-attach");
  expect(result?.html).toContain("border-dashed");
  expect(result?.html).not.toContain(">9<");
});

test("files whose addresses are not the backend's file addresses are refused before the backend is asked", async () => {
  backend(() => Response.json({ html: slot(4) }));
  for (const bad of [
    file(4, { url: "javascript:alert(1)" }),
    file(4, { url: "https://evil.test/a.png" }),
    file(4, { thumbnailUrl: '/api/v1/files/4"onerror=x' }),
    file(4, { url: "/api/v1/files/4/../../x" }),
    file(4, { url: "/api/v1/files/4,/x" }),
    file(4, { filename: "x".repeat(256) }),
    file(4, { widths: [{ url: "//evil.test/a", width: 320 }] }),
    file(0),
  ])
    expect(await revealSpoiler("post", 5, 0, [bad])).toBeNull();
  expect(await revealSpoiler("post", 5, 0, "files")).toBeNull();
  expect(urls).toEqual([]);
});

test("a colour typed inside a spoiler is guarded like one in the body", async () => {
  backend(() =>
    Response.json({ html: '<p><span style="color:#fff">white</span></p>' }),
  );
  const result = await revealSpoiler("post", 5, 0);
  expect(result?.html).toContain('class="bb-color" style="--ink:#fff"');
  expect(result?.html).not.toContain('style="color:');
});

test("the smilie codes of a spoiler show as the site's smilies, as in the body", async () => {
  backend(() =>
    Response.json({ html: "<p>jaja :LOL:</p><p><code>:LOL:</code></p>" }),
  );
  const result = await revealSpoiler("post", 5, 1);
  expect(result?.html).toContain(
    'jaja <span class="smilie" role="img" aria-label="Laugh" title="Laugh :LOL:">😆</span>',
  );
  expect(result?.html).toContain("<code>:LOL:</code>");
});
