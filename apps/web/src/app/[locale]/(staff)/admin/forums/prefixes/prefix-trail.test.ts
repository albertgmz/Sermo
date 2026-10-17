import { expect, mock, test } from "bun:test";
import { type Standing, trailOf } from "../../../registry";

mock.module("server-only", () => ({}));

const admin: Standing = {
  resolvedPermissions: { "admin.nodes": true, "admin.prefixes": true },
  staff: { panel: true, moderatesEverywhere: false, moderatedNodeIds: [] },
};

// The registry's own trail, with the key as the label.
mock.module("../../../trail", () => ({
  staffTrail: async (path: string) =>
    trailOf(admin, path).map(({ screen, href }) => ({
      href,
      label: screen.key,
    })),
}));

const { prefixTrail } = await import("./prefix-trail");

test("a prefix page hangs from the section's landing and the prefix list, not from the tree", async () => {
  // The registry puts the tree first because the addresses share its path.
  expect(
    trailOf(admin, "/admin/forums/prefixes/3").map(({ screen }) => screen.key),
  ).toContain("forumsTree");
  for (const path of [
    "/admin/forums/prefixes/new",
    "/admin/forums/prefixes/3",
  ]) {
    expect(await prefixTrail(path), path).toEqual([
      { href: "/admin", label: "home" },
      { href: "/admin/sections/forums", label: "forumsLanding" },
      { href: "/admin/forums/prefixes", label: "forumsPrefixes" },
    ]);
  }
});
