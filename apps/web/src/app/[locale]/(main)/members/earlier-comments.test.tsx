import { expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

// Each page of comments on post 9, newest first, by the cursor it is asked with.
const PAGES: Record<string, { ids: number[]; nextCursor: string | null }> = {
  newest: { ids: [30, 29, 28, 27], nextCursor: "b" },
  b: { ids: [20, 19, 18], nextCursor: "c" },
  c: { ids: [10, 9], nextCursor: null },
};
// Post 77 has 1200 comments, ids 1 to 1200, in pages of 20; its cursor names the id it reads below.
const BIG = 1200;
function bigPage(cursor: string | undefined) {
  const below = cursor === undefined ? BIG + 1 : Number(cursor);
  const ids: number[] = [];
  for (let id = below - 1; id >= 1 && ids.length < 20; id -= 1) ids.push(id);
  const lowest = ids.at(-1) ?? 1;
  return { ids, nextCursor: lowest > 1 ? String(lowest) : null };
}
const asked: (string | undefined)[] = [];
const client = await import("@/lib/sermo/client");
mock.module("@/lib/sermo/client", () => ({
  ...client,
  call: async (
    _contract: unknown,
    input: { profilePostId: number; cursor?: string },
  ) => {
    asked.push(input.cursor);
    const page =
      input.profilePostId === 77
        ? bigPage(input.cursor)
        : PAGES[input.cursor ?? "newest"];
    return {
      items: page.ids.map((id) => ({ id, author: { id: 1, username: "a" } })),
      nextCursor: page.nextCursor,
    };
  },
}));
mock.module("@/lib/sermo/session", () => ({
  getViewer: async () => ({
    user: null,
    permissions: { canReact: false },
    resolvedPermissions: {},
  }),
}));
const reactions = await import("@/lib/sermo/reactions");
mock.module("@/lib/sermo/reactions", () => ({
  ...reactions,
  getReactionTypes: async () => [],
}));
mock.module("@/lib/sermo/members", () => ({
  membersFor: async () => () => null,
}));

const { earlierComments } = await import("./earlier-comments");

async function load(...args: Parameters<typeof earlierComments>) {
  asked.length = 0;
  const page = await earlierComments(...args);
  return {
    ids: page.rows.map((row) => row.id),
    cursor: page.cursor,
    done: page.done,
    asked: [...asked],
  };
}

test("a press reads one page, from the newest less the comments the list shows, then on from its cursor", async () => {
  expect(await load(9, 5, 28, null, null, null)).toEqual({
    ids: [27],
    cursor: "b",
    done: false,
    asked: [undefined],
  });
  expect(await load(9, 5, 28, null, "b", null)).toEqual({
    ids: [18, 19, 20],
    cursor: "c",
    done: false,
    asked: ["b"],
  });
  expect(await load(9, 5, 28, null, "c", null)).toEqual({
    ids: [9, 10],
    cursor: null,
    done: true,
    asked: ["c"],
  });
});

test("an open page's presses start at its own cursor", async () => {
  expect(await load(9, 5, null, "b", null, null)).toEqual({
    ids: [18, 19, 20],
    cursor: "c",
    done: false,
    asked: ["b"],
  });
});

test("the list drawn again reads down to the oldest loaded comment and nothing older", async () => {
  // A new comment pushed 28 out of the newest few: it is loaded now, with no gap.
  expect(await load(9, 5, 29, null, null, 18)).toEqual({
    ids: [18, 19, 20, 27, 28],
    cursor: "c",
    done: false,
    asked: [undefined, "b"],
  });
  // The page that holds the oldest loaded one holds older ones too: those are left for the next
  // press, which reads that page again.
  expect(await load(9, 5, 29, null, null, 19)).toEqual({
    ids: [19, 20, 27, 28],
    cursor: "b",
    done: false,
    asked: [undefined, "b"],
  });
  // The oldest of all: none is left.
  expect(await load(9, 5, null, "b", null, 9)).toEqual({
    ids: [9, 10, 18, 19, 20],
    cursor: null,
    done: true,
    asked: ["b", "c"],
  });
});

test("every comment of a post with more than a thousand is reached, one page a press", async () => {
  let cursor: string | null = null;
  let done = false;
  const seen = new Set<number>();
  let presses = 0;
  while (!done) {
    const page = await load(77, 5, null, null, cursor, null);
    expect(page.asked.length).toBe(1);
    for (const id of page.ids) seen.add(id);
    ({ cursor, done } = page);
    presses += 1;
  }
  expect(seen.size).toBe(BIG);
  expect(presses).toBe(BIG / 20);
});

test("drawn again past the reading limit, what was read is kept and the button goes on from there", async () => {
  const page = await load(77, 5, null, null, null, 1);
  expect(page.asked.length).toBe(50);
  expect(page.ids.length).toBe(1000);
  expect(page.ids[0]).toBe(201);
  expect(page.done).toBe(false);
  expect(page.cursor).toBe("201");
});

test("ids that are not record ids never reach the backend", async () => {
  asked.length = 0;
  await expect(earlierComments(9, 5, null, null, null, 0)).rejects.toThrow();
  await expect(earlierComments(9, 5, -1, null, null, null)).rejects.toThrow();
  expect(asked).toEqual([]);
});
