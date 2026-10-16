import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { profilePostBody } from "@/lib/test-bodies";
import { withIntl } from "@/lib/test-intl";
import {
  type CreateData,
  focusComposer,
  focusFirstOption,
  stepAfterPick,
} from "./create-kinds";

// The flow hands on server actions.
mock.module("server-only", () => ({}));

mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ set: () => {}, get: () => undefined }),
}));
mock.module("next/cache", () => ({
  refresh: () => {},
  revalidatePath: () => {},
}));

const { CreateChooser, CreateFlow, wallPostAction } = await import(
  "./create-flow"
);
const { addressAfterForumChange } = await import("./thread-composer");
const { Dialog } = await import("@/components/ui/dialog");
const { ThreadComposer } = await import("./thread-composer");

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

// The flow as it is drawn once its one read has answered (`data`) or before it has.
function draw(state: { data?: CreateData }) {
  const client = new QueryClient();
  if (state.data) client.setQueryData(["create"], state.data);
  return renderToStaticMarkup(
    withIntl(
      <QueryClientProvider client={client}>
        <Dialog open>
          <CreateFlow visit={1} />
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

test("a composer in a dialog that names itself draws no title of its own", () => {
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

const realFetch = globalThis.fetch;
const sent: string[] = [];
beforeEach(() => {
  sent.length = 0;
  globalThis.fetch = (async (url: string) => {
    sent.push(String(url));
    return Response.json(
      { error: { code: "forbidden", message: "No." } },
      { status: 403 },
    );
  }) as unknown as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const body = (text: string) => {
  const data = new FormData();
  data.set("body", text);
  return data;
};

test("a wall post is posted to the wall of the member the read named, never to a wall the form names", async () => {
  const state = await wallPostAction(5)({}, body("hello"));
  expect(sent).toEqual(["http://127.0.0.1:8787/api/v1/users/5/profile-posts"]);
  // A refusal comes back as the form's message.
  expect(state.error).toBeTruthy();
  const other = body("hi");
  other.set("userId", "9");
  await wallPostAction(6)({}, other);
  expect(sent[1]).toContain("/users/6/");
});

test("a wall post that was taken goes on to the member's own wall", async () => {
  globalThis.fetch = (async () =>
    Response.json(
      profilePostBody({ profileUserId: 5 }),
    )) as unknown as typeof fetch;
  let digest = "";
  try {
    await wallPostAction(5)({}, body("hi"));
  } catch (error) {
    digest = String((error as { digest?: unknown }).digest);
  }
  expect(digest).toContain("/members/5");
});

test("a wall post skips the choice of forum, a thread goes through it once", () => {
  expect(stepAfterPick("wall", null)).toBe("compose");
  expect(stepAfterPick("wall", 2)).toBe("compose");
  for (const kind of ["discussion", "question", "poll"] as const) {
    expect(stepAfterPick(kind, null)).toBe("forum");
    expect(stepAfterPick(kind, 2)).toBe("compose");
  }
});

// A root that has only what the focus helpers ask of it.
function fake(fields: Record<string, { focus: () => void } | null>) {
  const root = {
    querySelector: (selector: string) => {
      for (const [key, value] of Object.entries(fields)) {
        if (selector.includes(key)) {
          return key.startsWith("data-create-mode")
            ? { querySelector: () => value }
            : value;
        }
      }
      return null;
    },
  };
  return root as unknown as ParentNode;
}

test("the first option takes focus when the choice is drawn, and nothing breaks before it is", () => {
  let focused = 0;
  expect(
    focusFirstOption(
      fake({ "data-create-option": { focus: () => focused++ } }),
    ),
  ).toBe(true);
  expect(focused).toBe(1);
  expect(focusFirstOption(fake({}))).toBe(false);
  expect(focusFirstOption(null)).toBe(false);
});

test("the composer that is shown takes focus, in the mode that is shown", () => {
  const log: string[] = [];
  const root = fake({
    'data-create-mode="thread"': { focus: () => log.push("thread") },
    'data-create-mode="wall"': { focus: () => log.push("wall") },
  });
  expect(focusComposer(root, "wall")).toBe(true);
  expect(focusComposer(root, "thread")).toBe(true);
  expect(log).toEqual(["wall", "thread"]);
  expect(focusComposer(fake({}), "thread")).toBe(false);
});

test("a change of forum moves the address on its page and never in a dialog", () => {
  expect(addressAfterForumChange("page", 3)).toBe("/forums/3/new");
  expect(addressAfterForumChange("dialog", 3)).toBeNull();
});

test("a poll the member did not ask for is not sent with a discussion, and one asked for is in the form", () => {
  const thread = (kind: "discussion" | "poll") =>
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
            canPoll
            memberId={5}
          />
        </Dialog>,
      ),
    );
  expect(thread("discussion")).not.toContain('name="poll"');
  expect(thread("poll")).toContain('name="poll"');
});

const { SHEET_CLASS } = await import("./composer");
const { STEP_COLUMN } = await import("./create-flow");
const { WallPostForm } = await import(
  "@/app/[locale]/(main)/members/post-composer"
);
const classes = (list: string) => list.split(/\s+/).filter(Boolean);
const source = (file: string) =>
  readFileSync(join(import.meta.dir, file), "utf8");

test("the Create dialog is the whole screen at every size; the wall page's sheet keeps its box from md", () => {
  const screen = classes(SHEET_CLASS.screen);
  for (const name of [
    "top-0",
    "left-0",
    "translate-x-0",
    "translate-y-0",
    "h-[var(--visible-height,100dvh)]",
    "max-w-none",
    "rounded-none",
    "bg-background",
  ])
    expect(screen).toContain(name);
  // Nothing turns it back into a box on a wider screen (`sm:max-w-none` lifts the dialog's own
  // `sm:max-w-sm`).
  expect(
    screen.filter((name) => /^(?:sm|md|lg|xl|2xl|min-\[)/.test(name)),
  ).toEqual(["sm:max-w-none"]);
  expect(classes(SHEET_CLASS.sheet)).toContain("md:max-w-xl");
  // The Create button's dialog is the screen; the wall page's composer is the sheet it was.
  expect(source("../layout/create-popup.tsx")).toContain(
    "<ComposerSheet open={open} screen>",
  );
  expect(
    source("../../app/[locale]/(main)/members/post-composer.tsx"),
  ).toContain("<ComposerSheet open={open} formRef={form}>");
});

test("each step is a column in the middle of the screen: the choices narrow, the composers as wide as the forum", () => {
  for (const column of [STEP_COLUMN.choice, STEP_COLUMN.writing]) {
    // The whole width on a phone, a surface edged on both sides from md.
    for (const name of [
      "mx-auto",
      "w-full",
      "flex-1",
      "md:border-x",
      "md:bg-card",
    ])
      expect(classes(column)).toContain(name);
  }
  expect(classes(STEP_COLUMN.choice)).toContain("max-w-2xl");
  expect(classes(STEP_COLUMN.writing)).toContain("max-w-(--container-width)");

  // The choice: a list on a phone, tiles two by two from md, and its loading shape the same.
  const chooser = draw({ data: DATA });
  expect(chooser).toContain(`class="${STEP_COLUMN.choice} flex"`);
  expect(chooser).toContain("md:grid-cols-2");
  expect(chooser).toMatch(
    /data-create-option="wall"[^>]*class="[^"]*md:min-h-36/,
  );
  expect(draw({})).toMatch(/role="status"[^>]*class="[^"]*md:grid-cols-2/);

  // The steps the flow reaches later: the forum list in the narrow column, the composers and
  // their loading shape in the wide one.
  const flow = source("create-flow.tsx");
  expect(flow).toMatch(
    /<div className=\{cn\(CHOICE, "flex"\)\}>\s*<ForumChoicePanel/,
  );
  expect(flow).toMatch(
    /data-create-mode="thread"\s*className=\{cn\(WRITING, threadOn \? "flex" : "hidden"\)\}/,
  );
  expect(flow).toMatch(
    /data-create-mode="wall"\s*className=\{cn\(WRITING, wallOn \? "flex" : "hidden"\)\}/,
  );
  expect(flow).toMatch(
    /access === null && \(\s*<div className=\{cn\(WRITING, "flex"\)\}>/,
  );
});

test("in the Create dialog the text of a thread or a wall post takes the rest of the screen; the wall page's sheet keeps its own", () => {
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
  const wall = (grow: boolean) =>
    renderToStaticMarkup(
      withIntl(
        <Dialog open>
          <WallPostForm
            action={async () => ({})}
            placeholder="What's on your mind?"
            name="Your wall"
            grow={grow}
          />
        </Dialog>,
      ),
    );
  for (const html of [thread, wall(true)]) {
    // The scrolling part is a column, and the text's frame stretches down to the bar of tools.
    expect(html).toMatch(
      /class="min-h-0 flex-1 overflow-y-auto flex flex-col"/,
    );
    expect(html).toMatch(
      /data-composer-grow=""[^>]*class="flex flex-1 cursor-text flex-col"><div class="[^"]*\bflex-1\b[^"]*"><textarea name="body"/,
    );
  }
  const sheet = wall(false);
  expect(sheet).not.toContain("data-composer-grow");
  expect(sheet).toContain('class="min-h-0 flex-1 overflow-y-auto"');
});
