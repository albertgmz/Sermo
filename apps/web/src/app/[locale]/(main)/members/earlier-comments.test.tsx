import { expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

// Each page of comments on the post, newest first, by the cursor it is asked with.
const PAGES: Record<string, { ids: number[]; nextCursor: string | null }> = {
  newest: { ids: [30, 29, 28, 27], nextCursor: "b" },
  b: { ids: [20, 19, 18], nextCursor: "c" },
  c: { ids: [10, 9], nextCursor: null },
};
const asked: (string | undefined)[] = [];
const client = await import("@/lib/sermo/client");
mock.module("@/lib/sermo/client", () => ({
  ...client,
  call: async (_contract: unknown, input: { cursor?: string }) => {
    asked.push(input.cursor);
    const page = PAGES[input.cursor ?? "newest"];
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
    nextCursor: page.nextCursor,
    oldest: page.oldest,
    asked: [...asked],
  };
}

test("the first batch is the newest page, less the comments the list shows", async () => {
  expect(await load(9, 5, 28, null, null)).toEqual({
    ids: [27],
    nextCursor: "b",
    oldest: 27,
    asked: [undefined],
  });
});

test("the next batch reads again from the start, one page past the oldest loaded", async () => {
  expect(await load(9, 5, 28, null, 26)).toEqual({
    ids: [18, 19, 20, 27],
    nextCursor: "c",
    oldest: 18,
    asked: [undefined, "b"],
  });
});

test("the list drawn again reads down to the same comment, from the newest it does not show", async () => {
  // A new comment pushed 28 out of the newest few: it is loaded now, with no gap.
  expect(await load(9, 5, 29, null, 18)).toEqual({
    ids: [18, 19, 20, 27, 28],
    nextCursor: "c",
    oldest: 18,
    asked: [undefined, "b"],
  });
});

test("an open page's batches start at its cursor, and the last one leaves none", async () => {
  expect(await load(9, 5, null, "b", 17)).toEqual({
    ids: [9, 10, 18, 19, 20],
    nextCursor: null,
    oldest: 9,
    asked: ["b", "c"],
  });
});

test("ids that are not record ids never reach the backend", async () => {
  asked.length = 0;
  await expect(earlierComments(9, 5, null, null, 0)).rejects.toThrow();
  await expect(earlierComments(9, 5, -1, null, null)).rejects.toThrow();
  expect(asked).toEqual([]);
});
