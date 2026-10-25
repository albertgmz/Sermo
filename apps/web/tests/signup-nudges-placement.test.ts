import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { walk } from "./lite-scan";

// Where a guest's invitations to create an account can be drawn: never on the log-in, sign-up and
// other account pages (their own layout holds none of them), and their code comes after the page
// is interactive, not with its first load.
const root = import.meta.dir.replace(/tests$/, "");
const read = (path: string) => readFileSync(`${root}${path}`, "utf8");
const sources = walk("src").filter(
  (path) => /\.tsx?$/.test(path) && !/\.test\.tsx?$/.test(path),
);
const importing = (module: string) =>
  sources.filter((path) =>
    new RegExp(
      `from\\s+["'][^"']*/${module}["']|import\\(\\s*["'][^"']*/${module}["']`,
    ).test(read(path)),
  );

test("the account pages draw no invitation, no sign-up window and no floating card", () => {
  const auth = sources.filter((path) =>
    path.startsWith("src/app/[locale]/(auth)/"),
  );
  expect(auth.length).toBeGreaterThan(0);
  for (const module of [
    "layout/app-prompts-gate",
    "layout/app-prompts-lazy",
    "layout/signup-nudges",
    "layout/join-window",
    "layout/join-link",
    "forum/signup-invite",
  ])
    for (const path of importing(module))
      expect(auth, `${path} imports ${module}`).not.toContain(path);
  // The floating card and the window are mounted by the forum's layout alone.
  expect(importing("layout/app-prompts-gate")).toEqual([
    "src/app/[locale]/(main)/layout.tsx",
  ]);
});

test("the floating card and the sign-up window are loaded lazily", () => {
  expect(importing("layout/signup-nudges")).toEqual([
    "src/components/layout/app-prompts-lazy.tsx",
  ]);
  expect(read("src/components/layout/app-prompts-lazy.tsx")).toMatch(
    /dynamic\(\s*\(\)\s*=>\s*import\("@\/components\/layout\/signup-nudges"\)/,
  );
  expect(importing("layout/join-window")).toEqual([
    "src/components/layout/signup-nudges.tsx",
  ]);
  expect(read("src/components/layout/signup-nudges.tsx")).not.toMatch(
    /^import[^;]*layout\/join-window"/m,
  );
});
