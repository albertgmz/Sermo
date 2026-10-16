import { expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { withIntl } from "@/lib/test-intl";
import type { CreateData } from "./create-kinds";

// The flow hands on server actions.
mock.module("server-only", () => ({}));

const { CreateChooser, CreateFlow } = await import("./create-flow");
const { Dialog } = await import("@/components/ui/dialog");
const { ThreadComposer } = await import("./thread-composer");
const { endedInRedirect } = await import("./use-kept-form");

const DATA: CreateData = {
  memberId: 5,
  forums: [
    {
      id: 1,
      parentId: null,
      title: "Support",
      type: "category",
      canPost: false,
    },
    { id: 2, parentId: 1, title: "Help", type: "forum", canPost: true },
  ],
  prefixes: [],
  canTag: false,
  canWall: true,
};

const source = (path: string) =>
  readFileSync(join(import.meta.dir, "../..", path), "utf8");

// The flow as it is drawn once its one read has answered (`data`) or before it has.
function draw(state: { data?: CreateData }) {
  const client = new QueryClient();
  if (state.data) client.setQueryData(["create"], state.data);
  return renderToStaticMarkup(
    withIntl(
      <QueryClientProvider client={client}>
        <Dialog open>
          <CreateFlow visit={1} onSent={() => {}} />
        </Dialog>
      </QueryClientProvider>,
    ),
  );
}

const options = (html: string) =>
  [...html.matchAll(/data-create-option="(\w+)"/g)].map((match) => match[1]);

test("the flow opens on the choice of what to write, with the options of a member who may do all of it", () => {
  const html = draw({ data: DATA });
  expect(options(html)).toEqual(["discussion", "question", "poll", "wall"]);
  expect(html).toContain("Poll or quiz");
  expect(html).toContain("Wall post");
  // The dialog is named once, however many composers it holds.
  expect(html.match(/data-slot="dialog-title"/g)).toHaveLength(1);
  // Nothing of the composer is loaded before something is chosen.
  expect(html).not.toContain('name="body"');
  expect(html).not.toContain("Choose a forum");
});

test("a member who may post in no forum sees only the wall post", () => {
  const html = draw({
    data: {
      ...DATA,
      forums: [{ ...DATA.forums[0] }, { ...DATA.forums[1], canPost: false }],
    },
  });
  expect(options(html)).toEqual(["wall"]);
});

test("a member who may post nowhere is told there is nothing to post", () => {
  const html = draw({ data: { ...DATA, forums: [], canWall: false } });
  expect(options(html)).toEqual([]);
  expect(html).toContain("There is nothing you can post here.");
});

test("before the answer the flow shows a loading state, and a refused read says so and offers another try", async () => {
  const waiting = draw({});
  expect(waiting).toContain('role="status"');
  expect(options(waiting)).toEqual([]);
  const refused = renderToStaticMarkup(
    withIntl(
      <Dialog open>
        <CreateChooser
          data={undefined}
          failed
          onPick={() => {}}
          onRetry={() => {}}
        />
      </Dialog>,
    ),
  );
  expect(refused).toContain("Could not load what you can create.");
  expect(refused).toContain("Try again");
  expect(options(refused)).toEqual([]);
});

test("each choice leads to the right mode of the shared composer, and a wall post posts to the member's own wall", () => {
  const src = source("components/forum/create-flow.tsx");
  // A thread kind goes to the forum choice, then to the thread composer in a dialog with the kind.
  expect(src).toContain('setStep(forumId === null ? "forum" : "compose")');
  expect(src).toContain('frame="dialog"');
  expect(src).toContain("kind={threadKind}");
  // The wall post skips the forum choice and goes straight to the composer.
  expect(src).toMatch(
    /if \(next === "wall"\) \{\s*setWallOpened\(true\);\s*setStep\("compose"\)/,
  );
  // It is posted to the member's own wall, which the form never names: the id comes from the read.
  expect(src).toMatch(
    /postToWall\.bind\(\s*null,\s*data\.memberId,\s*`\/members\/\$\{data\.memberId\}`,?\s*\)/,
  );
  // The forum list is the shared one, not a copy.
  expect(src).toContain('from "@/components/forum/forum-choice-panel"');
  // A post that was taken starts the flow over through the one callback.
  expect(src.match(/onSent=\{onSent\}/g)).toHaveLength(2);
});

test("the choice of forum lists only the forums the member may post in", async () => {
  const { choiceRows } = await import("./forum-choices");
  const rows = choiceRows(DATA.forums);
  expect(rows.filter((row) => row.selectable).map((row) => row.title)).toEqual([
    "Help",
  ]);
  expect(choiceRows([{ ...DATA.forums[1], canPost: false }])).toEqual([]);
});

test("a question is a discussion worded as one, and a poll opens the poll section", () => {
  const draw = (kind: "discussion" | "question" | "poll", canPoll: boolean) =>
    renderToStaticMarkup(
      withIntl(
        <Dialog open>
          <ThreadComposer
            frame="dialog"
            kind={kind}
            forumId={2}
            forums={DATA.forums}
            prefixes={[]}
            canAttach={false}
            canTag={false}
            canPoll={canPoll}
            memberId={5}
          />
        </Dialog>,
      ),
    );
  expect(draw("discussion", true)).toContain('placeholder="Thread title"');
  const question = draw("question", true);
  expect(question).toContain('placeholder="What is your question?"');
  // A question sends an ordinary thread: the fields are the same.
  expect(question).toContain('name="title"');
  expect(question).not.toContain('name="poll"');
  // A poll comes with the section open (its field is in the form), where a discussion has a button.
  const poll = draw("poll", true);
  expect(poll).toContain('name="poll"');
  expect(draw("discussion", true)).toContain("Add a poll or quiz");
  // In a forum that allows none the member is told, and no poll is sent.
  const refused = draw("poll", false);
  expect(refused).not.toContain('name="poll"');
  expect(refused).toContain("not allowed in this forum");
  // In a dialog the composer is not a page: its close is the dialog's, not a link back.
  expect(poll).not.toContain('href="/forums/2"');
});

test("a thread composer in a dialog never changes the address of the page it is on", () => {
  const src = source("components/forum/thread-composer.tsx");
  expect(src).toMatch(
    /if \(frame === "page"\) \{\s*window\.history\.replaceState/,
  );
});

test("a send that ends in a redirect, and only that, tells a form in the layout that the post was taken", () => {
  const before = {};
  expect(endedInRedirect(before, before)).toBe(true);
  // A refusal answers with a new state.
  expect(endedInRedirect(before, { error: "No." })).toBe(false);
  // Nothing was sent.
  expect(endedInRedirect(null, before)).toBe(false);
});

test("a composer in a dialog that names itself draws no title of its own, and a navigation closes the dialog", () => {
  const popup = readFileSync(
    join(import.meta.dir, "../layout/create-popup.tsx"),
    "utf8",
  );
  expect(popup).toContain("usePathname()");
  expect(popup).toContain("setOpen(false)");
  const thread = renderToStaticMarkup(
    withIntl(
      <Dialog open>
        <ThreadComposer
          frame="dialog"
          forumId={2}
          forums={DATA.forums}
          prefixes={[]}
          canAttach={false}
          canTag={false}
          canPoll={false}
          memberId={5}
        />
      </Dialog>,
    ),
  );
  expect(thread).not.toContain('data-slot="dialog-title"');
});
