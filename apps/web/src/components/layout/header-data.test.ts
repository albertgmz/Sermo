import { afterEach, mock, test } from "bun:test";
import assert from "node:assert/strict";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  headers: async () => new Headers({ cookie: "sermo.session_token=live" }),
  cookies: async () => ({ set: () => {} }),
}));

const { getViewerCard } = await import("./header-data");

const member = {
  user: {
    id: 1,
    username: "ann",
    email: "ann@example.test",
    groupId: 2,
    createdAt: "2026-01-01T00:00:00.000Z",
    displayGroup: null,
  },
  permissions: {
    isAdmin: false,
    isModerator: false,
    canViewProfiles: true,
    canPostProfile: false,
    canStartConversations: false,
    canReact: false,
  },
  resolvedPermissions: {},
  staff: {
    panel: false,
    moderatesEverywhere: false,
    moderatedNodeIds: [],
    moderatedNodesTruncated: false,
  },
};

function backend(cards: Response) {
  globalThis.fetch = (async (url: string) =>
    url.includes("/member-cards")
      ? cards
      : Response.json(member)) as unknown as typeof fetch;
}

test("a refused read of the member's card draws the member from the viewer's name", async () => {
  backend(
    Response.json(
      { error: { code: "rate_limited", message: "Slow down" } },
      { status: 429 },
    ),
  );
  const card = await getViewerCard();
  assert.equal(card?.id, 1);
  assert.equal(card?.username, "ann");
  assert.equal(card?.avatar, null);
});

test("a failure that is not the backend's answer is not hidden", async () => {
  globalThis.fetch = (async (url: string) => {
    if (url.includes("/member-cards")) throw new RangeError("broken");
    return Response.json(member);
  }) as unknown as typeof fetch;
  await assert.rejects(getViewerCard(), RangeError);
});
