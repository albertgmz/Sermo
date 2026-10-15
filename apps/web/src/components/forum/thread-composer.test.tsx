import { expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { withIntl } from "@/lib/test-intl";

// The composer hands on server actions.
mock.module("server-only", () => ({}));

const { ThreadComposer, threadReady, composeAddress } = await import(
  "./thread-composer"
);
const { ComposerForm } = await import("./composer");

const FORUMS = [
  { id: 1, parentId: null, title: "Support", type: "category", canPost: false },
  { id: 2, parentId: 1, title: "Help", type: "forum", canPost: true },
  { id: 3, parentId: 1, title: "Bugs", type: "forum", canPost: true },
] as const;
const PREFIXES = [
  { id: 7, label: "Solved", color: "#22aa66", icon: "circle-check" },
];

const source = (path: string) =>
  readFileSync(join(import.meta.dir, "../..", path), "utf8");

// The part of a composer that holds its close button and Post.
const HEADER = /<div class="flex items-center justify-between/;

function plainForm(cover?: React.ReactNode) {
  return renderToStaticMarkup(
    withIntl(
      <ComposerForm
        onSubmit={() => {}}
        frame={{ kind: "page", closeHref: "/forums/2" }}
        submitLabel="Post"
        pending={false}
        placeholder="Write"
        cover={cover}
      />,
    ),
  );
}

test("Post waits for a title and a text", () => {
  expect(threadReady("", "")).toBe(false);
  expect(threadReady("A title", "")).toBe(false);
  expect(threadReady("", "Some text")).toBe(false);
  expect(threadReady("   ", "Some text")).toBe(false);
  expect(threadReady("A title", " \n ")).toBe(false);
  expect(threadReady("A title", "Some text")).toBe(true);
});

test("a thread starts out unsendable: Post is disabled, beside the forum chip, the title line and the prefix chips", () => {
  const html = renderToStaticMarkup(
    withIntl(
      <ThreadComposer
        forumId={2}
        forums={[...FORUMS]}
        prefixes={PREFIXES}
        canAttach
      />,
    ),
  );
  const post = html.match(/<button[^>]*type="submit"[^>]*>/)?.[0] ?? "";
  expect(post).toContain('disabled=""');
  expect(html).toContain("Posting in");
  expect(html).toContain(">Help<");
  expect(html).toContain('name="title"');
  expect(html).toContain("Solved");
  expect(html).toContain('name="prefixId"');
  // The text is the shared composer's: a plain field that becomes the editor when it is entered.
  expect(html).toContain('name="body"');
  // Close goes back to the forum, on a page.
  expect(html).toContain('href="/forums/2"');
});

test("a forum without prefixes draws no prefix chips", () => {
  const html = renderToStaticMarkup(
    withIntl(
      <ThreadComposer
        forumId={2}
        forums={[...FORUMS]}
        prefixes={[]}
        canAttach={false}
      />,
    ),
  );
  expect(html).not.toContain('name="prefixId"');
});

test("the address follows the forum", () => {
  expect(composeAddress(3)).toBe("/forums/3/new");
});

test("the forum choice takes the screen without taking the draft away", () => {
  const html = plainForm(<p>Choose a forum</p>);
  // Both are in the page: the choice, and the composer (text field included), which is hidden.
  expect(html).toContain("Choose a forum");
  expect(html).toContain('name="body"');
  const wrapper = html.match(
    /<div class="([^"]*)">(?=<div class="flex items-center justify-between)/,
  );
  expect(wrapper?.[1]).toContain("hidden");
});

test("without a cover the composer is shown", () => {
  const html = plainForm();
  expect(html).toMatch(HEADER);
  const wrapper = html.match(
    /<div class="([^"]*)">(?=<div class="flex items-center justify-between)/,
  );
  expect(wrapper?.[1]).not.toContain("hidden");
});

test("changing the forum is a change of state and of address, never a navigation or a reset", () => {
  const src = source("components/forum/thread-composer.tsx");
  expect(src).toContain("window.history.replaceState");
  expect(src).not.toMatch(/useRouter|router\.(push|replace)|redirect\(/);
  // Nothing is keyed by the forum (a key would start the fields over) and nothing is reset.
  expect(src).not.toMatch(/\bkey=\{(forum|target)\b/);
  expect(src).not.toMatch(/\.reset\(|resetKey/);
  // The forum is read when the thread is sent, so the latest choice is the one used.
  expect(src).toContain("createThreadAction(target.current");
});

test("a refused thread keeps what was written: the form is the kept form and the fields are state", () => {
  const src = source("components/forum/thread-composer.tsx");
  expect(src).toContain("useKeptForm");
  for (const field of ["title", "body", "prefixId"]) {
    expect(src).toMatch(
      new RegExp(`const \\[${field}, set\\w+\\] = useState\\(""\\)`),
    );
  }
});

test("a wall post and a new thread are written in the same composer component", () => {
  for (const path of [
    "app/[locale]/(main)/members/post-composer.tsx",
    "components/forum/thread-composer.tsx",
  ]) {
    const src = source(path);
    expect(src, path).toContain('from "@/components/forum/composer"');
    expect(src, path).toContain("<ComposerForm");
    // None of the parts the shared composer owns is built again.
    expect(src, path).not.toMatch(
      /<LazyEditor|<Editor|<AttachmentField|visualViewport/,
    );
  }
});
