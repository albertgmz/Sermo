import { afterEach, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));
const { drawCard } = await import("./card-image");
const { brandOf } = await import("./card");

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

// The renderer downloads a font from Google, or an emoji picture from a CDN, for a character its
// fonts lack. A card is drawn from the fonts of the app alone, whatever the text holds.
test("drawing a card in any script or with emoji fetches nothing", async () => {
  const asked: string[] = [];
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    // The renderer loads its own WebAssembly from data addresses.
    if (url.startsWith("data:")) return realFetch(input, init);
    asked.push(url);
    throw new Error(`Unexpected fetch of ${url}`);
  }) as typeof fetch;
  const brand = brandOf({
    name: "Jardín 🌿 庭",
    icon: null,
    accents: [],
  });
  const texts = [
    "¿Podamos los rosales? Ñandú, pingüino",
    "Привет мир — Γειά σου",
    "🌹🔥 Rosas © ™ ® ‼ ↔ 日本語 한국어 中文 العربية עברית हिन्दी ไทย",
    "👨‍👩‍👧 🏳️‍🌈 ✌🏽",
  ];
  for (const title of texts) {
    for (const content of [
      { kind: "threads" as const, title, forum: title, author: title },
      { kind: "forums" as const, title, parents: [title], description: title },
      { kind: "members" as const, title, description: title },
      { kind: "site" as const, title, description: title },
    ]) {
      const png = await drawCard(content, brand, null);
      expect(png.byteLength).toBeGreaterThan(0);
    }
  }
  expect(asked).toEqual([]);
});
