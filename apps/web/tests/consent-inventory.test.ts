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
import { exportedStrings, scanSource } from "./consent-scan";
import { sourceFiles } from "./lite-scan";

// Every name the code writes into the browser must be in the inventory that the cookie policy page
// and the banner are drawn from. The scan (`consent-scan.ts`) reads every call that writes a
// cookie or a storage key, in every file, and resolves its name; a name that is not listed, or
// cannot be resolved, fails here.
const ROOT = join(import.meta.dir, "..");
const files = sourceFiles().filter((file) => /\.tsx?$/.test(file));
const sources = Object.fromEntries(
  files.map((file) => [file, readFileSync(join(ROOT, file), "utf8")]),
);
const globals = exportedStrings(sources);
// A hole of a template literal, written out in the source texts the scan is tried on.
const hole = (name: string) => ["$", "{", name, "}"].join("");
const tick = "`";
const code = (...parts: string[]) => parts.join("");
const inCategory = (name: string, storage: Storage) =>
  CATEGORIES.some((category) => ownedBy(category, name, storage));

function found(pattern: RegExp) {
  return files.flatMap((file) =>
    [...(sources[file] as string).matchAll(pattern)].map((match) => ({
      file,
      name: match[1] as string,
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

test("every name the code writes into the browser is in the inventory", () => {
  const checked: string[] = [];
  const problems: string[] = [];
  for (const file of files) {
    const scan = scanSource(file, sources[file] as string, globals);
    checked.push(...scan.checked);
    problems.push(...scan.problems);
  }
  expect(problems).toEqual([]);
  // The scan must really see the writers: each of these is a known one.
  for (const expected of [
    "src/app/[locale]/(main)/actions.ts forum_lite",
    "src/app/[locale]/(main)/actions.ts forum_locale",
    "src/app/[locale]/(main)/actions.ts forum_notices_dismissed",
    "src/app/[locale]/(main)/account/actions.ts forum_locale",
    "src/proxy.ts forum_lite",
    "src/components/layout/theme.ts sermo-theme",
    "src/components/layout/narrow-width.ts sermo-width",
    // The sessionStorage key is read from the source, not written out here.
    "src/components/layout/lite-mode-sync.tsx forum_lite:reloads",
    "src/app/[locale]/(main)/forums/forum-stats.tsx forum-stats-open",
    "src/app/[locale]/(main)/forums/page.tsx forum-category-1-open",
    "src/lib/sermo/auth.ts (passed through)",
    "src/components/forum/collapsible-panel.tsx (passed through)",
  ])
    expect(checked, expected).toContain(expected);
});

test("a name that is not in the inventory fails the scan, in any file", () => {
  const scan = (path: string, source: string) =>
    scanSource(path, source, globals).problems;
  // Files that already write to the browser are held to the same rule.
  for (const path of [
    "src/proxy.ts",
    "src/app/[locale]/(main)/actions.ts",
    "src/lib/sermo/auth.ts",
    "src/components/layout/lite-mode-sync.tsx",
    "src/components/forum/collapsible-panel.tsx",
    "src/components/new.tsx",
  ]) {
    expect(scan(path, `store.set("tracker", "1");`), path).toHaveLength(1);
    expect(
      scan(path, `response.cookies.set("tracker", "1", {});`),
      path,
    ).toHaveLength(1);
    expect(
      scan(path, `(await cookies()).set("tracker", "1");`),
      path,
    ).toHaveLength(1);
    expect(
      scan(path, `document.cookie = "tracker=1; path=/";`),
      path,
    ).toHaveLength(1);
    expect(
      scan(path, `localStorage.setItem("tracker", "1");`),
      path,
    ).toHaveLength(1);
    expect(
      scan(path, `window.sessionStorage.setItem("tracker", "1");`),
      path,
    ).toHaveLength(1);
    expect(
      scan(
        path,
        code(
          "sessionStorage.setItem(",
          tick,
          hole("LITE_COOKIE"),
          ":other",
          tick,
          ', "1");',
        ),
      ),
      path,
    ).toHaveLength(1);
    expect(
      scan(path, `store.set({ name: "tracker", value: "1" });`),
      path,
    ).toHaveLength(1);
    expect(
      scan(path, `const KEY = "tracker"; store.set(KEY, "1");`),
      path,
    ).toHaveLength(1);
    expect(
      scan(path, `const a = <Panel storageKey="tracker" />;`),
      path,
    ).toHaveLength(1);
    expect(
      scan(
        path,
        code(
          "const a = <Panel storageKey={",
          tick,
          "tracker-",
          hole("id"),
          tick,
          "} />;",
        ),
      ),
      path,
    ).toHaveLength(1);
  }
  // A name held in a variable the scan cannot resolve is a problem outside the two pass-through
  // files, and a literal is a problem even inside them.
  expect(scan("src/components/new.tsx", `store.set(name, "1");`)).toHaveLength(
    1,
  );
  expect(
    scan("src/lib/sermo/auth.ts", `store?.set({ name: parsed.name, value });`),
  ).toHaveLength(0);
  expect(
    scan("src/lib/sermo/auth.ts", `store.set("tracker", "1");`),
  ).toHaveLength(1);
  // Listed names pass, written as a literal, a constant or a template.
  expect(
    scan("src/components/new.tsx", `store.set(LITE_COOKIE, "1");`),
  ).toEqual([]);
  expect(
    scan("src/components/new.tsx", `store.set("forum_locale", "1");`),
  ).toEqual([]);
  expect(
    scan("src/components/new.tsx", `store.set(CONSENT_COOKIE, "1");`),
  ).toEqual([]);
  expect(
    scan(
      "src/components/new.tsx",
      code(
        "sessionStorage.setItem(",
        tick,
        hole("LITE_COOKIE"),
        ":reloads",
        tick,
        ', "1");',
      ),
    ),
  ).toEqual([]);
  expect(
    scan("src/components/new.tsx", `localStorage.setItem("sermo-theme", "1");`),
  ).toEqual([]);
  // A cookie name is not a storage key, and the other way round.
  expect(
    scan(
      "src/components/new.tsx",
      `localStorage.setItem("forum_locale", "1");`,
    ),
  ).toHaveLength(1);
  expect(
    scan("src/components/new.tsx", `store.set("sermo-theme", "1");`),
  ).toHaveLength(1);
});

test("a cookie written through another receiver, a header or a storage property is found too", () => {
  const scan = (source: string) =>
    scanSource("src/components/new.tsx", source, globals).problems;
  // Known by the shape of the call, whatever the variable is called.
  expect(
    scan(
      `const jar = await cookies(); jar.set("tracker", "1", { path: "/" });`,
    ),
  ).toHaveLength(1);
  expect(scan(`jar.set("tracker", "1", { maxAge: 5 });`)).toHaveLength(1);
  expect(scan(`jar.set({ name: "tracker", value: "1" });`)).toHaveLength(1);
  expect(
    scan(`jar.set(LITE_COOKIE, "1", { httpOnly: false, path: "/" });`),
  ).toEqual([]);
  // A map or a set is not a cookie.
  expect(
    scan(`refs.set(id, { id, username: "x" }); seen.set("tracker", 1);`),
  ).toEqual([]);
  // A Set-Cookie header, appended or set, is a write of the cookie it names.
  expect(
    scan(`res.headers.append("set-cookie", "tracker=1; Path=/");`),
  ).toHaveLength(1);
  expect(scan(`headers.set("Set-Cookie", "tracker=1");`)).toHaveLength(1);
  expect(
    scan(`headers.append("Set-Cookie", "forum_locale=en; Path=/");`),
  ).toEqual([]);
  expect(scan(`headers.append("Set-Cookie", value);`)).toHaveLength(1);
  // Storage written as a property.
  expect(scan(`localStorage.tracker = "1";`)).toHaveLength(1);
  expect(scan(`window.localStorage["tracker"] = "1";`)).toHaveLength(1);
  expect(scan(`localStorage["sermo-theme"] = "dark";`)).toEqual([]);
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
