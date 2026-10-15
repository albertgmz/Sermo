import { afterEach, expect, mock, test } from "bun:test";
import { serializeLiteCookie } from "@/lib/lite-preferences";
import { translator } from "@/lib/test-intl";

// Only the request and the network are stood in for; the client, the LITE filter and the contract
// are the real ones.
let cookie = "";
mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({
    set: () => {},
    get: () => undefined,
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
    urls.push(String(input));
    return response();
  }) as unknown as typeof fetch;
}
afterEach(() => {
  globalThis.fetch = realFetch;
  cookie = "";
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
