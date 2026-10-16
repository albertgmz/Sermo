import { afterEach, beforeEach, expect, mock, test } from "bun:test";
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
