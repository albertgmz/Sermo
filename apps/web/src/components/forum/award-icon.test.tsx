import { afterAll, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ICONS } from "@/components/icons/icon-set";

mock.module("server-only", () => ({}));
const liteMode = { ...(await import("@/lib/lite-mode")) };
mock.module("@/lib/lite-mode", () => ({
  ...liteMode,
  liteBlocks: async () => false,
}));
const { AwardIcon } = await import("./award-icon");

afterAll(() => {
  mock.module("@/lib/lite-mode", () => liteMode);
});

async function glyph(icon: string) {
  const element = await AwardIcon({
    award: { name: "Hero", icon, tier: "gold" },
  });
  return renderToStaticMarkup(element);
}

test("an award draws any icon of the site's set, not only a short list", async () => {
  const medal = await glyph("");
  expect(medal).toContain("lucide-award");
  for (const key of ["shield-check", "gamepad-2", "gem", "trophy"]) {
    const html = await glyph(key);
    expect(html, key).not.toBe(medal);
    expect(html, key).not.toContain("lucide-award ");
  }
});

test("a key the set does not hold draws the default medal", async () => {
  expect(await glyph("retired-icon")).toBe(await glyph(""));
});

test("every icon of the set draws a glyph of its own", async () => {
  const drawn = new Set<string>();
  for (const key of Object.keys(ICONS)) drawn.add(await glyph(key));
  expect(drawn.size).toBeGreaterThan(100);
});
