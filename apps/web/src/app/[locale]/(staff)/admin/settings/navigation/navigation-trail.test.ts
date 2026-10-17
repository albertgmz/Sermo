import { expect, mock, test } from "bun:test";
import { type Standing, trailOf } from "../../../registry";

mock.module("server-only", () => ({}));

const admin: Standing = {
  resolvedPermissions: { "admin.settings": true, "admin.navigation": true },
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

const { navigationTrail } = await import("./navigation-trail");

test("a navigation page hangs from the section's landing and the navigation list, not from the general settings", async () => {
  // The registry puts the general settings in the way because the addresses share its path.
  expect(
    trailOf(admin, "/admin/settings/navigation/new").map(
      ({ screen }) => screen.key,
    ),
  ).toContain("setupGeneral");
  for (const path of [
    "/admin/settings/navigation/new",
    "/admin/settings/navigation/sort",
    "/admin/settings/navigation/5",
  ]) {
    expect(await navigationTrail(path), path).toEqual([
      { href: "/admin", label: "home" },
      { href: "/admin/sections/setup", label: "setupLanding" },
      { href: "/admin/settings/navigation", label: "setupNavigation" },
    ]);
  }
});
