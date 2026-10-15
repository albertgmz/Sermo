import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { bundleWorker, precacheManifest } from "../scripts/build-sw-lib";

// apps/web, whatever the folder the tests run from.
const root = new URL("..", import.meta.url).pathname
  .replace(/^\/(?=[a-z]:)/i, "")
  .replace(/%20/g, " ");
const dir = decodeURIComponent(root);

test("the worker bundles into one classic script with its precache list filled in", async () => {
  const script = await bundleWorker(dir);
  // The offline page is in the list, with the revision the build computed.
  const [entry] = precacheManifest(dir);
  expect(script).toContain(entry.url);
  expect(script).toContain(entry.revision);
  expect(entry.revision).toMatch(/^[0-9a-f]{16}$/);
  // Nothing is left for the browser to resolve: the placeholder is replaced, no import or
  // `process` remains, and the cache it names is there.
  expect(script).not.toContain("__SW_MANIFEST");
  expect(script).not.toMatch(/\bimport\s*[{(*"']|process\.env/);
  expect(script).toContain("-static-v1");
  expect(script.length).toBeLessThan(150_000);
});

test("the precache list is the offline page and nothing else", () => {
  expect(precacheManifest(dir).map(({ url }) => url)).toEqual([
    "/offline.html",
  ]);
});

// The worker was once a route that bundled it at request time, which a production image without
// the source cannot do. It is a build step now: these fail if that changes back.
test("the worker is built by the build script and is no route", () => {
  const pkg = JSON.parse(readFileSync(`${dir}/package.json`, "utf8"));
  expect(pkg.scripts.build).toMatch(/^bun scripts\/build-sw\.ts && next build/);
  expect(existsSync(`${dir}/scripts/build-sw.ts`)).toBe(true);
  expect(existsSync(`${dir}/src/app/serwist`)).toBe(false);
  expect(existsSync(`${dir}/src/app/sw.ts`)).toBe(false);
  expect(readFileSync(`${dir}/next.config.ts`, "utf8")).not.toContain(
    "serwist",
  );
  expect(readFileSync(`${dir}/.gitignore`, "utf8")).toContain("/public/sw.js");
});
