import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  deleteStaleCaches,
  isImmutable,
  isPageNavigation,
  isStaticAsset,
  OFFLINE_URL,
  offlineFallback,
  STATIC_CACHE,
  staleCaches,
} from "./pwa-routes";

const here = (
  path: string,
  init: { mode?: string; destination?: string } = {},
) => ({
  request: { mode: init.mode ?? "cors", destination: init.destination ?? "" },
  url: new URL(`https://forum.test${path}`),
  sameOrigin: true,
});

test("the files of the build are kept", () => {
  for (const path of [
    "/_next/static/chunks/app-1a2b3c.js",
    "/_next/static/css/app.css",
    "/_next/static/media/inter-latin.woff2",
  ])
    expect(isStaticAsset(here(path))).toBe(true);
});

test("pages, the API, files, uploads and Next's data requests are never kept", () => {
  for (const path of [
    "/",
    "/threads/12-news",
    "/api/v1/threads",
    "/api/v1/files/5",
    "/attachments",
    "/threads/12/uploads",
    "/account/picture",
    "/_next/image?url=%2Fapi%2Fv1%2Ffiles%2F5&w=64",
    "/sw.js",
    "/manifest.webmanifest",
  ])
    expect(isStaticAsset(here(path)), path).toBe(false);
  // A file of another site with the same path is not ours to keep.
  expect(
    isStaticAsset({ ...here("/_next/static/x.js"), sameOrigin: false }),
  ).toBe(false);
});

test("only the browser loading a page of the site is a page navigation", () => {
  expect(isPageNavigation(here("/threads/12", { mode: "navigate" }))).toBe(
    true,
  );
  expect(isPageNavigation(here("/", { mode: "navigate" }))).toBe(true);
  // The fetch behind a link, an action's request and a file read by a script.
  expect(isPageNavigation(here("/threads/12", { mode: "cors" }))).toBe(false);
  expect(isPageNavigation(here("/threads/12", { mode: "same-origin" }))).toBe(
    false,
  );
  // A file opened in a tab goes to the network as it is.
  expect(isPageNavigation(here("/api/v1/files/5", { mode: "navigate" }))).toBe(
    false,
  );
  expect(
    isPageNavigation({ ...here("/", { mode: "navigate" }), sameOrigin: false }),
  ).toBe(false);
});

test("a failed page load gets the offline page, a failed anything else gets nothing", () => {
  expect(offlineFallback.url).toBe(OFFLINE_URL);
  expect(offlineFallback.matcher(here("/", { destination: "document" }))).toBe(
    true,
  );
  for (const destination of ["", "script", "image", "style", "font"])
    expect(offlineFallback.matcher(here("/", { destination }))).toBe(false);
});

test("the caches of an older worker are deleted, the current one and other owners' are not", () => {
  expect(
    staleCaches([
      STATIC_CACHE,
      "sermo-static-v0",
      "sermo-pages",
      "serwist-precache-v2-https://forum.test/",
      "other-app-cache",
    ]),
  ).toEqual(["sermo-static-v0", "sermo-pages"]);
});

test("taking over deletes them", async () => {
  const names = new Set([STATIC_CACHE, "sermo-static-v0", "sermo-pages"]);
  await deleteStaleCaches({
    keys: async () => [...names],
    delete: async (name) => names.delete(name),
  });
  expect([...names]).toEqual([STATIC_CACHE]);
});

test("the offline page is a file the worker can keep, in both languages", () => {
  const page = readFileSync(
    new URL(`../../public${OFFLINE_URL}`, import.meta.url),
    "utf8",
  );
  expect(page).toContain('lang="en"');
  expect(page).toContain('lang="es"');
  expect(page).toContain("prefers-color-scheme:dark");
  expect(page).toContain("data-retry");
  // It is served by the worker with nothing else of the app: it names no file of its own.
  expect(page).not.toMatch(/<(?:link|img)\b|src=|href=/);
});

test("a picture under the build's folder is left to the browser, as the data saver answers it", () => {
  for (const path of [
    "/_next/static/media/logo.png",
    "/_next/static/media/Logo.SVG",
    "/_next/static/media/a.webp",
    "/_next/static/media/a.png.",
    "/_next/static/media/a%2Epng",
  ])
    expect(isStaticAsset(here(path)), path).toBe(false);
  expect(isStaticAsset(here("/_next/static/media/inter.woff2"))).toBe(true);
});

test("only what the server calls immutable is worth keeping", () => {
  const answer = (cacheControl?: string) =>
    new Response(
      "",
      cacheControl ? { headers: { "cache-control": cacheControl } } : {},
    );
  expect(isImmutable(answer("public, max-age=31536000, immutable"))).toBe(true);
  expect(isImmutable(answer("immutable"))).toBe(true);
  for (const value of [
    "no-store",
    "public, max-age=0",
    "max-age=3, notimmutable",
    undefined,
  ])
    expect(isImmutable(answer(value)), String(value)).toBe(false);
});
