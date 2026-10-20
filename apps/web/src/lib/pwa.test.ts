import { expect, test } from "bun:test";
import { isPwaPath, manifestOf, shortName } from "./pwa";

const site = {
  name: "Garden Club",
  description: "Plants and people",
  icon: null,
  accents: [{ color: "#2e7d32" }, { color: "#1565c0" }],
};

test("the manifest takes the site's name, description and first accent", () => {
  const manifest = manifestOf(site);
  expect(manifest.name).toBe("Garden Club");
  expect(manifest.short_name).toBe("Garden Club");
  expect(manifest.description).toBe("Plants and people");
  expect(manifest.theme_color).toBe("#2e7d32");
  expect(manifest.start_url).toBe("/");
  expect(manifest.scope).toBe("/");
  expect(manifest.display).toBe("standalone");
});

test("a site with no accent and no description gets the defaults", () => {
  const manifest = manifestOf({ ...site, description: "", accents: [] });
  expect(manifest.theme_color).toBe("#dc2626");
  expect(manifest.background_color).toBe("#fafafa");
  expect("description" in manifest).toBe(false);
});

test("the uploaded icon is the manifest's icon", () => {
  const manifest = manifestOf({ ...site, icon: { url: "/api/v1/files/4" } });
  expect(manifest.icons).toEqual([
    { src: "/api/v1/files/4", sizes: "512x512", type: "image/png" },
  ]);
});

test("a site without an icon gets the default mark in both sizes, one of them maskable", () => {
  const icons = manifestOf(site).icons ?? [];
  expect(icons.map(({ src, sizes }) => `${src} ${sizes}`)).toEqual([
    "/pwa-icon/192 192x192",
    "/pwa-icon/512 512x512",
    "/pwa-icon/512 512x512",
  ]);
  expect(icons.map(({ purpose }) => purpose)).toEqual([
    undefined,
    undefined,
    "maskable",
  ]);
});

test("the short name fits under an icon", () => {
  expect(shortName("Sermo")).toBe("Sermo");
  expect(shortName("Garden Club Of Springfield")).toBe("Garden");
  expect(shortName("Internationalization")).toBe("Internationa");
  expect(shortName("Una comunidad enorme")).toBe("Una");
});

test("the proxy leaves only the app's own files alone", () => {
  for (const path of [
    "/manifest.webmanifest",
    "/offline.html",
    "/sw.js",
    "/pwa-icon/192",
  ])
    expect(isPwaPath(path)).toBe(true);
  for (const path of [
    "/",
    "/offline",
    "/sw.js.map",
    "/serwist/sw.js",
    "/threads/1",
    "/es/manifest.webmanifest",
  ])
    expect(isPwaPath(path)).toBe(false);
});
