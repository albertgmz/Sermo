import { afterEach, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ set: () => {}, toString: () => "" }),
}));

const { relationsFor } = await import("./members");

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
      ignoring: false,
      canIgnore: true,
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
    ignoring: false,
    canIgnore: true,
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
