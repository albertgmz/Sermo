import { afterEach, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ set: () => {}, toString: () => "" }),
}));

const { authorsFor, membersFor, relationsFor } = await import("./members");

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

// Answers every relations read with the given flags for the ids it was asked about.
function backend(respond: (ids: number[]) => Response) {
  const asked: string[][] = [];
  globalThis.fetch = (async (input: string) => {
    const url = new URL(input);
    const ids = url.searchParams.getAll("userIds");
    asked.push([url.pathname, ...ids]);
    return respond(ids.map(Number));
  }) as unknown as typeof fetch;
  return asked;
}

const answer = (ids: number[]) =>
  Response.json({
    items: ids.map((userId) => ({
      userId,
      following: userId % 2 === 0,
      canFollow: true,
      canMessage: userId !== 3,
      blocking: false,
      canBlock: true,
    })),
  });

test("a page of authors is one read as the viewer, one entry per distinct member", async () => {
  const asked = backend((ids) => answer(ids));
  const relation = await relationsFor(1, [2, 3, 2, 4, 3]);
  expect(asked).toEqual([["/api/v1/member-relations", "2", "3", "4"]]);
  expect(relation(2)).toEqual({
    following: true,
    canFollow: true,
    canMessage: true,
    blocking: false,
    canBlock: true,
  });
  expect(relation(3)?.canMessage).toBe(false);
  expect(relation(99)).toBeNull();
});

test("a guest asks nothing and has no relations", async () => {
  const asked = backend((ids) => answer(ids));
  const relation = await relationsFor(null, [2, 3]);
  expect(asked).toHaveLength(0);
  expect(relation(2)).toBeNull();
});

test("more than 50 members are asked for in chunks of 50", async () => {
  const asked = backend((ids) => answer(ids));
  const ids = Array.from({ length: 51 }, (_, i) => i + 10);
  const relation = await relationsFor(1, ids);
  expect(asked.map((call) => call.length - 1)).toEqual([50, 1]);
  expect(relation(60)).not.toBeNull();
});

test("a refusal leaves the page without buttons instead of failing it", async () => {
  backend(() =>
    Response.json(
      { error: { code: "rate_limited", message: "Slow down." } },
      { status: 429 },
    ),
  );
  const relation = await relationsFor(1, [2]);
  expect(relation(2)).toBeNull();
});

test("a request the backend calls invalid is not hidden", async () => {
  backend(() =>
    Response.json(
      { error: { code: "validation", message: "Invalid." } },
      { status: 422 },
    ),
  );
  await expect(relationsFor(1, [2])).rejects.toThrow("Invalid.");
});

test("an answer that breaks the contract is not hidden", async () => {
  const log = console.error;
  console.error = () => {};
  try {
    backend(() => Response.json({ items: [{ userId: 2 }] }));
    await expect(relationsFor(1, [2])).rejects.toThrow(
      "does not match its contract",
    );
  } finally {
    console.error = log;
  }
});

test("a guest author is drawn by the name given, and no member is asked for it", async () => {
  const asked = backend(() => Response.json({ items: [] }));
  const member = await membersFor([
    { kind: "guest", name: "Wanderer" },
    { kind: "member", id: 2, username: "ana" },
  ]);
  expect(asked).toEqual([["/api/v1/member-cards", "2"]]);
  expect(member({ kind: "guest", name: "Wanderer" })).toMatchObject({
    username: "Wanderer",
    avatar: null,
    restricted: true,
  });
  expect(member({ kind: "member", id: 2, username: "ana" }).username).toBe(
    "ana",
  );
  expect(member(2).username).toBe("ana");
});

test("an author carries the device of their latest sign-in as the backend parsed it, else none", async () => {
  const card = (id: number) => ({
    id,
    username: `m${id}`,
    avatar: null,
    frame: null,
    nameColor: null,
    nameIcon: null,
    title: "",
    badges: [],
    level: 1,
    restricted: false,
  });
  const device = { type: "phone", os: "Android", browser: "Chrome" };
  backend(() =>
    Response.json({
      items: [2, 3].map((id) => ({
        card: card(id),
        cover: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        postCount: 0,
        reactionScore: 0,
        awardXp: 0,
        currentLevelXp: 0,
        nextLevelXp: 100,
        awards: [],
        signatureHtml: null,
        lastActivityAt: null,
        lastActivityHidden: false,
        device: id === 2 ? device : null,
      })),
    }),
  );
  const author = await authorsFor([
    { id: 2, username: "m2" },
    { id: 3, username: "m3" },
    { id: 4, username: "m4" },
  ]);
  expect(author(2).device).toEqual(device);
  expect(author(3).device).toBeNull();
  // A member the backend did not answer for.
  expect(author(4).device).toBeNull();
});
