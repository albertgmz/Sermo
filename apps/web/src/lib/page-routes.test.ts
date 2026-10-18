import { expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { isPageRoute, PAGE_ROUTES } from "./page-routes";

const APP = join(import.meta.dir, "..", "app", "[locale]");

// The address of every page file under `app/[locale]`, route groups left out of it.
function pageAddresses(dir: string, parts: string[] = []): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name === "page.tsx")
      found.push(`/${parts.join("/")}`);
    if (!entry.isDirectory()) continue;
    const group = /^\(.+\)$/.test(entry.name);
    found.push(
      ...pageAddresses(
        join(dir, entry.name),
        group ? parts : [...parts, entry.name],
      ),
    );
  }
  return found;
}

test("the list names every page outside the staff panel, and nothing else", () => {
  const pages = pageAddresses(APP).filter(
    (address) =>
      // The panel's addresses are its registry's; the fallback is what the list keeps away.
      !/^\/(admin|moderation)(\/|$)/.test(address) && address !== "/[...rest]",
  );
  expect([...PAGE_ROUTES].sort()).toEqual(pages.sort());
});

test("a page's address is known, with any value in its parameters", () => {
  for (const path of [
    "/",
    "/threads/12-a-title",
    "/threads/12/edit/40",
    "/forums/3/new",
    "/tags/café au lait",
    "/conversations/new",
    "/account/",
  ])
    expect(isPageRoute(path)).toBe(true);
});

test("an address no page answers is not known", () => {
  for (const path of [
    "/this-does-not-exist",
    "/threads",
    "/threads/12/history",
    "/forums/3/new/more",
    "/tags",
    "/Threads/12",
    "/account/lite",
    "/.well-known/anything",
    "/not-found",
    "/sw.js.map",
    "//",
  ])
    expect(isPageRoute(path)).toBe(false);
});
