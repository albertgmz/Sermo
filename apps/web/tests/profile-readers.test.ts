import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { walk } from "./lite-scan";

const root = import.meta.dir.replace(/tests$/, "");
const source = (path: string) => readFileSync(`${root}${path}`, "utf8");

// A profile row that saves does not tell Next to read any page again (account/actions.ts). That is
// correct only while every page that shows the profile reads it from the backend on each visit:
// the profile page, the member card and the postbit. None of them may keep it in a Next cache.
const READERS = [
  ...walk("src/app/[locale]/(main)/members/[id]"),
  "src/lib/sermo/members.ts",
  "src/components/forum/member-card-action.tsx",
  "src/components/forum/postbit.tsx",
].filter((path) => /\.tsx?$/.test(path) && !/\.test\.tsx?$/.test(path));

test("the pages that show a profile read it on each visit", () => {
  expect(READERS).toContain("src/app/[locale]/(main)/members/[id]/profile.ts");
  for (const path of READERS) {
    const text = source(path);
    expect(text, path).not.toMatch(/["']use cache/);
    expect(text, path).not.toMatch(/\bunstable_cache\b|\bcacheTag\(/);
  }
  // Every request to the backend skips the fetch cache.
  expect(source("src/lib/sermo/transport.ts")).toContain('cache: "no-store"');
});
