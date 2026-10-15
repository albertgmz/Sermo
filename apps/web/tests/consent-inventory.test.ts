import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import en from "../messages/en/cookies.json";
import {
  CATEGORIES,
  CONSENT_COOKIE,
  INVENTORY,
  ownedBy,
  type Storage,
} from "../src/lib/consent/inventory";
import { sourceFiles } from "./lite-scan";

// Every name the code writes into the browser must be in the inventory that the cookie policy page
// and the banner are drawn from. A name the scan finds and the inventory lacks fails here; so
// does a new file that writes to the browser at all, until its names are listed.
const ROOT = join(import.meta.dir, "..");
const files = sourceFiles().filter(
  (file) => !/\.test\.tsx?$/.test(file) && !file.includes("/lib/consent/"),
);
const source = (file: string) => readFileSync(join(ROOT, file), "utf8");
const inCategory = (name: string, storage: Storage) =>
  CATEGORIES.some((category) => ownedBy(category, name, storage));

function found(pattern: RegExp) {
  return files.flatMap((file) =>
    [...source(file).matchAll(pattern)].map((match) => ({
      file,
      name: match[1],
    })),
  );
}

test("every cookie name constant is in the inventory", () => {
  const names = found(/export const \w*COOKIE\w*\s*=\s*"([^"]+)"/g);
  expect(names.length).toBeGreaterThanOrEqual(3);
  for (const { file, name } of names)
    expect(inCategory(name, "cookie"), `${name} (${file})`).toBe(true);
});

test("every session cookie name the code reads or writes is in the inventory", () => {
  const names = found(/"((?:__Secure-)?sermo\.(?:session|dont)[a-z_]*)"/g);
  expect(names.length).toBeGreaterThan(0);
  for (const { file, name } of names)
    expect(inCategory(name, "cookie"), `${name} (${file})`).toBe(true);
});

test("every storage key the code writes is in the inventory", () => {
  const keys = [
    ...found(/const \w*(?:WIDTH|THEME)_KEY\s*=\s*"([^"]+)"/g),
    ...found(/storageKey="([^"]+)"/g),
    ...found(/storageKey=\{`([^`$]+)/g),
  ];
  expect(keys.length).toBeGreaterThanOrEqual(4);
  for (const { file, name } of keys)
    expect(inCategory(name, "localStorage"), `${name} (${file})`).toBe(true);
  expect(inCategory("forum_lite:reloads", "sessionStorage")).toBe(true);
});

test("only files whose names are in the inventory write to the browser", () => {
  const writers = files
    .filter((file) =>
      /document\.cookie\s*=|(?:local|session)Storage\.setItem|(?:store\??|cookies|\))\.set\(/.test(
        source(file),
      ),
    )
    .map((file) => file.replaceAll("\\", "/"))
    .sort();
  expect(writers).toEqual(
    [
      "src/app/[locale]/(main)/account/actions.ts",
      "src/app/[locale]/(main)/actions.ts",
      "src/components/forum/collapsible-panel.tsx",
      "src/components/layout/lite-mode-sync.tsx",
      "src/components/layout/narrow-width.ts",
      "src/components/layout/theme.ts",
      "src/lib/sermo/auth.ts",
      "src/proxy.ts",
    ].sort(),
  );
});

test("the consent cookie is listed as strictly necessary", () => {
  expect(ownedBy("necessary", CONSENT_COOKIE)).toBe(true);
  expect(ownedBy("analytics", CONSENT_COOKIE)).toBe(false);
});

test("every optional category lists what it stores, and every item has its words", () => {
  for (const category of CATEGORIES)
    expect(
      INVENTORY.some((item) => item.category === category),
      category,
    ).toBe(true);
  for (const item of INVENTORY) {
    const words = (
      en.items as Record<
        string,
        { title: string; purpose: string; lifetime: string }
      >
    )[item.id];
    expect(
      words?.title && words.purpose && words.lifetime,
      item.id,
    ).toBeTruthy();
  }
  expect(Object.keys(en.items).sort()).toEqual(
    INVENTORY.map((item) => item.id).sort(),
  );
});
