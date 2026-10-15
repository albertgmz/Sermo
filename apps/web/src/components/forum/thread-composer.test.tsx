import { expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { withIntl } from "@/lib/test-intl";

// The composer hands on server actions.
mock.module("server-only", () => ({}));

const { ThreadComposer, threadReady, composeAddress, sendUnlessPicking } =
  await import("./thread-composer");
const { ComposerForm } = await import("./composer");
const { panelKey } = await import("./forum-choice-panel");
const { AttachmentField } = await import("./attachment-field");

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
        memberId={1}
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
        memberId={1}
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

test("Enter in the forum search does nothing, so it cannot send the thread", () => {
  let prevented = 0;
  let back = 0;
  const key = (name: string, tagName: string) => ({
    key: name,
    target: { tagName },
    preventDefault: () => {
      prevented++;
    },
    stopPropagation: () => {},
  });
  panelKey(key("Enter", "INPUT"), () => {
    back++;
  });
  expect(prevented).toBe(1);
  expect(back).toBe(0);
  // Escape goes back to the composer.
  panelKey(key("Escape", "INPUT"), () => {
    back++;
  });
  expect(back).toBe(1);
  // Other keys, and Enter on a button, are left alone.
  panelKey(key("a", "INPUT"), () => {});
  panelKey(key("Enter", "BUTTON"), () => {});
  expect(prevented).toBe(2);
});

test("a submit while the forum choice is open is stopped and sends nothing", () => {
  let prevented = 0;
  let sent = 0;
  const event = {
    preventDefault: () => {
      prevented++;
    },
  };
  sendUnlessPicking(true, event, () => {
    sent++;
  });
  expect(prevented).toBe(1);
  expect(sent).toBe(0);
  sendUnlessPicking(false, event, () => {
    sent++;
  });
  expect(prevented).toBe(1);
  expect(sent).toBe(1);
});

test("the draft is written from what the member changes, never from a send finishing", () => {
  const src = source("components/forum/thread-composer.tsx");
  // Restored in an effect once the page is drawn, never while drawing.
  expect(src).toMatch(
    /useEffect\(\(\) => \{\s*const kept = readThreadDraft\(memberId\)/,
  );
  // Written by the handlers of the title, the text and the prefix, through one function.
  expect(src).toContain("keep({ title: event.target.value })");
  expect(src).toContain("keep({ body: text })");
  expect(src).toContain("keep({ prefixId: next })");
  // Nothing written is tied to a send finishing: no effect reads `pending`, and the one write
  // outside the handlers answers a refusal.
  expect(src).not.toMatch(/\[[^\]]*\bpending\b[^\]]*\]\);/);
  expect(src).toContain(
    "if (state.error) writeThreadDraft(memberId, draft.current)",
  );
  // Sending forgets the draft, and changes made while it is on its way are not written.
  expect(src).toMatch(/clearThreadDraft\(memberId\);\s*send\(event\)/);
  expect(src).toContain(
    "if (!sending.current) writeThreadDraft(memberId, draft.current)",
  );
});

test("the files already added stay listed when the forum no longer allows attaching", () => {
  const html = renderToStaticMarkup(
    withIntl(
      <AttachmentField
        compact
        allowed={false}
        initial={[{ id: 4, name: "plan.pdf", size: 2048 }]}
      />,
    ),
  );
  expect(html).toContain("plan.pdf");
  expect(html).toContain('name="attachmentIds" value="4"');
  expect(html).not.toContain('type="file"');
  const allowed = renderToStaticMarkup(withIntl(<AttachmentField compact />));
  expect(allowed).toContain('type="file"');
});

test("the composer pins its bar on a page and never hides the attachment list", () => {
  const src = source("components/forum/composer.tsx");
  expect(src).toContain("allowed={attach}");
  expect(src).not.toMatch(/attach \? "contents" : "hidden"/);
  expect(src).toMatch(/"sticky bottom-\(--spacing-mobile-nav\)/);
  // It follows the keyboard up on a page, with the same visual viewport the sheet uses.
  expect(src).toContain('useVisualViewport(frame.kind === "page")');
  expect(src).toContain("{ bottom: inset }");
  // The safe area is counted once: by the sheet's bar at the screen's edge, not by the page's.
  expect(src).toMatch(
    /frame\.kind === "dialog"\s*\?\s*"pb-\[calc\(0\.25rem\+env\(safe-area-inset-bottom\)\)\]/,
  );
});
