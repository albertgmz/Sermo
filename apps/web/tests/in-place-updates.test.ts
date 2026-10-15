import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = (path: string) =>
  readFileSync(join(import.meta.dir, "..", "src", path), "utf8");

// The body of an exported async function of a module.
function bodyOf(code: string, name: string) {
  const start = code.indexOf(`export async function ${name}(`);
  expect(start, name).toBeGreaterThan(-1);
  const next = code.indexOf("\nexport ", start + 1);
  return code.slice(start, next === -1 ? undefined : next);
}

// A reaction, a bookmark and a follow change the item where it is drawn. Drawing the page again
// would read every page of a long list again for one click.
test("the reaction, bookmark and follow actions draw nothing again", () => {
  const actions = source("app/[locale]/(main)/actions.ts");
  for (const name of ["react", "setBookmark", "followFromPage"]) {
    const body = bodyOf(actions, name);
    expect(body, name).not.toMatch(/\brefresh\(|revalidate|redirect\(/);
  }
});

test("the buttons that send them do not draw the page again either", () => {
  for (const file of [
    "components/forum/reaction-button.tsx",
    "components/forum/bookmark-button.tsx",
    "components/forum/member-follow-button.tsx",
    "components/forum/reaction-summary-live.tsx",
  ]) {
    const code = source(file);
    expect(code, file).not.toMatch(/router\.refresh|\brefresh\(|useRouter/);
    // What is shown comes from the store of changes, not from state that a row losing its place
    // in a long list would lose.
    expect(code, file).not.toContain("useOptimistic");
  }
  for (const file of [
    "components/forum/reaction-button.tsx",
    "components/forum/bookmark-button.tsx",
    "components/forum/member-follow-button.tsx",
  ]) {
    expect(source(file), file).toContain("changeItem(");
  }
});

test("every follow button of a member and every control of an item shares one key", () => {
  expect(source("components/forum/member-follow-button.tsx")).toContain(
    "`follow:",
  );
  expect(source("components/forum/bookmark-button.tsx")).toContain(
    "`bookmark:",
  );
  expect(source("components/forum/reactions.tsx")).toContain("`reaction:");
});

test("the reply forms show the text at once through the tail and keep a refused one", () => {
  for (const file of [
    "app/[locale]/(main)/conversations/[id]/reply-form.tsx",
    "app/[locale]/(main)/threads/[id]/reply-composer.tsx",
  ]) {
    const code = source(file);
    expect(code, file).toContain("useTailForm(");
    expect(code, file).toContain("replyInPlace");
  }
  const hook = source("components/forum/use-tail-form.ts");
  expect(hook).toContain("sendIntoTail(");
  // Nothing is sent in place to a page that does not show the end.
  expect(hook).toContain("tailIsShown(");
});

test("the in-place sends are actions that answer with a row and never redirect or refresh", () => {
  for (const file of [
    "app/[locale]/(main)/conversations/reply-in-place.ts",
    "app/[locale]/(main)/threads/reply-in-place.ts",
  ]) {
    const code = source(file);
    expect(code, file).not.toMatch(/\brefresh\(|redirect\(/);
    expect(code, file).toContain("Rows(");
  }
});
