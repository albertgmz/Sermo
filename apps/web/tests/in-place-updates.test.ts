import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..", "src");
const source = (path: string) => readFileSync(join(root, path), "utf8");

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
    // They may go to the sign-in page (`router.push`) but never draw the page again.
    expect(code, file).not.toMatch(/router\.refresh|\brefresh\(/);
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

test("the follow button of the feed's suggestions is the in-place one", () => {
  const code = source("app/[locale]/(main)/_feed/feed-sidebar.tsx");
  expect(code).toContain("<MemberFollowButton");
  expect(code).not.toMatch(/<FollowButton\b/);
  expect(code).not.toContain("wall-buttons");
});

// A button is told how old its markup is by its props object (`lib/item-state`). A client component
// that builds one on each of its own renders would make it look drawn just now.
test("a client component that creates a change button keeps the element between its renders", () => {
  const buttons =
    /<(BookmarkButton|ReactionButton|MemberFollowButton|ReactionSummaryLive)[\s/>]/;
  let seen = 0;
  const walk = (dir: string) => {
    for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(path);
      else if (/\.tsx$/.test(entry.name) && !entry.name.includes(".test.")) {
        const code = source(path);
        if (code.startsWith('"use client"') && buttons.test(code)) {
          seen += 1;
          expect(code, path).toContain("useMemo(");
        }
      }
    }
  };
  walk("components");
  walk("app");
  expect(seen).toBeGreaterThan(0);
});

test("what drawing an added post needs is read on the server, never taken from the browser", () => {
  for (const file of [
    "app/[locale]/(main)/threads/poll-posts.ts",
    "app/[locale]/(main)/threads/reply-in-place.ts",
  ]) {
    expect(source(file), file).not.toMatch(/context|PostRowContext/);
  }
  expect(source("app/[locale]/(main)/threads/[id]/post-item.tsx")).toContain(
    "countView: false",
  );
});

test("the tab drops what it remembers when the page is drawn for another visitor", () => {
  expect(source("app/[locale]/(main)/layout.tsx")).toContain("<ViewerScope");
  const scope = source("components/layout/viewer-scope.tsx");
  expect(scope).toContain("enterViewer(");
  expect(scope).toContain("announceViewerChange()");
  // Both stores answer to it.
  expect(source("lib/item-state.ts")).toContain("registerStore(");
  expect(source("lib/tail.ts")).toContain("registerStore(");
});
