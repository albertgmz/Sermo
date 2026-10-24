import { expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { messages } from "@/i18n/messages";
import { withIntl } from "@/lib/test-intl";

// The composer hands on server actions.
mock.module("server-only", () => ({}));

const {
  ThreadComposer,
  threadReady,
  composeAddress,
  sendUnlessPicking,
  OFFER_LOADING,
  offerFrom,
  prefixBlocks,
} = await import("./thread-composer");
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

// The part of a composer that holds its close button.
const HEADER = /<div class="flex items-center gap-2 border-b p-2"/;

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

test("Post also waits for a prefix where the forum asks for one", () => {
  expect(threadReady("A title", "Some text", true)).toBe(false);
  expect(threadReady("A title", "Some text", false)).toBe(true);
});

test("Post waits while a forum's prefixes load, and after a read that failed, and for a required prefix", () => {
  const ready = offerFrom({ prefixes: PREFIXES, requirePrefix: true });
  expect(prefixBlocks(OFFER_LOADING, "")).toBe(true);
  expect(prefixBlocks(OFFER_LOADING, "7")).toBe(true);
  expect(prefixBlocks(offerFrom(null), "7")).toBe(true);
  expect(offerFrom(null).status).toBe("failed");
  expect(prefixBlocks(ready, "")).toBe(true);
  expect(prefixBlocks(ready, "7")).toBe(false);
  expect(
    prefixBlocks(offerFrom({ prefixes: [], requirePrefix: false }), ""),
  ).toBe(false);
});

test("changing the forum asks for its prefixes again, and a failed read can be asked again", () => {
  const src = source("components/forum/thread-composer.tsx");
  // The forum chosen is asked for through the one function the retry button calls too.
  expect(src).toMatch(/target\.current = id;[\s\S]*?loadForum\(id\);/);
  expect(src).toContain("loadForum(target.current)");
  expect(src).toContain("setOffered(OFFER_LOADING)");
  expect(src).toContain('offered.status === "failed"');
  // An answer for a forum the member has since left is dropped.
  expect(src).toMatch(/if \(turn !== asked\.current\) return;/);
});

test("a forum that asks for a prefix says so above the chips until one is chosen", () => {
  const draw = (requirePrefix: boolean) =>
    renderToStaticMarkup(
      withIntl(
        <ThreadComposer
          forumId={2}
          forums={[...FORUMS]}
          prefixes={PREFIXES}
          requirePrefix={requirePrefix}
          canAttach
          canTag
          canPoll={false}
          memberId={1}
        />,
      ),
    );
  expect(draw(true)).toContain("Choose a prefix to post in this forum.");
  expect(draw(false)).not.toContain("Choose a prefix to post in this forum.");
});

test("a thread starts out unsendable: Post is disabled, beside the forum chip, the title line and the prefix menu", () => {
  const html = renderToStaticMarkup(
    withIntl(
      <ThreadComposer
        forumId={2}
        forums={[...FORUMS]}
        prefixes={PREFIXES}
        requirePrefix={false}
        canAttach
        canTag
        canPoll={false}
        memberId={1}
      />,
    ),
  );
  const post = html.match(/<button[^>]*type="submit"[^>]*>/)?.[0] ?? "";
  expect(post).toContain('disabled=""');
  expect(html).toContain("Posting in");
  expect(html).toContain(">Help<");
  expect(html).toContain('name="title"');
  // The prefix menu's button, showing that none is chosen; its labels come with the menu.
  expect(html).toContain('aria-label="Prefix: (No prefix)"');
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
        requirePrefix={false}
        canAttach={false}
        canTag={false}
        canPoll={false}
        memberId={1}
      />,
    ),
  );
  expect(html).not.toContain('name="prefixId"');
  // A member who may not tag threads gets no field for tags.
  expect(html).not.toContain('name="tags"');
});

test("the field for tags is part of the form of a member who may tag threads", () => {
  const html = renderToStaticMarkup(
    withIntl(
      <ThreadComposer
        forumId={2}
        forums={[...FORUMS]}
        prefixes={[]}
        requirePrefix={false}
        canAttach={false}
        canTag
        canPoll={false}
        memberId={1}
      />,
    ),
  );
  expect(html).toContain('name="tags"');
  expect(html).toContain("#rust #tutorial");
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
    /<div class="([^"]*)">(?=<div class="flex items-center gap-2 border-b p-2")/,
  );
  expect(wrapper?.[1]).toContain("hidden");
});

test("the submit is not at the top: it ends the bottom row, labelled, after Attach files", () => {
  const html = plainForm();
  const header = html.slice(html.search(HEADER));
  const top = header.slice(0, header.indexOf("</div>"));
  expect(top).not.toContain('type="submit"');
  const submit = html.indexOf('type="submit"');
  expect(submit).toBeGreaterThan(
    html.indexOf(messages.forum.attachmentField.attach),
  );
  expect(html.slice(submit, html.indexOf("</button>", submit))).toContain(
    "Post",
  );
  // The formatting bar comes with the text, above it: no bar of its own at the bottom.
  expect(source("components/forum/composer.tsx")).not.toContain(
    "toolbarContainer",
  );
});

test("without a cover the composer is shown", () => {
  const html = plainForm();
  expect(html).toMatch(HEADER);
  const wrapper = html.match(
    /<div class="([^"]*)">(?=<div class="flex items-center gap-2 border-b p-2")/,
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
    /frame\.kind === "dialog"\s*\?\s*"pb-\[calc\(0\.5rem\+env\(safe-area-inset-bottom\)\)\]/,
  );
});

test("the section for a poll or quiz is part of the form of a member who may start one", () => {
  const draw = (canPoll: boolean) =>
    renderToStaticMarkup(
      withIntl(
        <ThreadComposer
          forumId={2}
          forums={[...FORUMS]}
          prefixes={[]}
          requirePrefix={false}
          canAttach={false}
          canTag={false}
          canPoll={canPoll}
          memberId={1}
        />,
      ),
    );
  expect(draw(true)).toContain("Add a poll or quiz");
  expect(draw(false)).not.toContain("Add a poll or quiz");
  // Closed, it sends nothing: the thread has no poll unless the section was opened.
  expect(draw(true)).not.toContain('name="poll"');
});

test("a new thread is posted with XenForo's pen, a wall post with the reply arrow", () => {
  const html = renderToStaticMarkup(
    withIntl(
      <ThreadComposer
        forumId={2}
        forums={[...FORUMS]}
        prefixes={PREFIXES}
        requirePrefix={false}
        canAttach
        canTag={false}
        canPoll={false}
        memberId={1}
      />,
    ),
  );
  const submit = (markup: string) =>
    markup.match(/<button[^>]*type="submit"[^>]*>(.*?)<\/button>/)?.[1] ?? "";
  expect(submit(html)).toContain("lucide-square-pen");
  expect(submit(plainForm())).toContain("lucide-reply");
});
