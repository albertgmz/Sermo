import { afterEach, mock, spyOn, test } from "bun:test";
import assert from "node:assert/strict";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const incoming = new Headers({ cookie: "sermo.session_token=live" });
mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  headers: async () => incoming,
  cookies: async () => ({ set: () => {} }),
}));

const { getCounters, getViewerCard } = await import("./header-data");
const { getNavigation } = await import("@/lib/sermo/navigation");
const { getViewer } = await import("@/lib/sermo/session");

const member = {
  user: {
    id: 1,
    username: "ann",
    email: "ann@example.test",
    groupId: 2,
    createdAt: "2026-01-01T00:00:00.000Z",
    displayGroup: null,
    language: null,
    keyboardShortcuts: true,
    homeTab: null,
    openHomeTab: "latest",
    pendingAcceptance: [],
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

// The shell's data helpers run above every error boundary: a failed auth.me must not reach them as
// an error, whatever way it fails.
const MEFAILS: [string, () => Promise<Response>][] = [
  [
    "429",
    async () =>
      Response.json(
        { error: { code: "rate_limited", message: "Slow down" } },
        { status: 429 },
      ),
  ],
  [
    "500",
    async () =>
      Response.json(
        { error: { code: "internal", message: "Broken" } },
        { status: 500 },
      ),
  ],
  [
    "a network failure",
    async () => {
      throw new TypeError("fetch failed");
    },
  ],
  ["a contract mismatch", async () => Response.json({ user: 7 })],
];

for (const [what, answer] of MEFAILS) {
  test(`the shell's helpers draw a guest when auth.me fails with ${what}`, async () => {
    const quiet = spyOn(console, "error").mockImplementation(() => {});
    const asked: string[] = [];
    globalThis.fetch = (async (url: string) => {
      asked.push(new URL(url).pathname);
      return answer();
    }) as unknown as typeof fetch;
    try {
      assert.equal(await getViewerCard(), null);
      assert.deepEqual(await getCounters(), {
        conversations: 0,
        notifications: 0,
        openReports: { count: 0, more: false },
        pendingApprovals: { count: 0, more: false },
      });
      // Nothing but the one read that failed went out: no member's data is asked for a guest.
      assert.deepEqual([...new Set(asked)], ["/api/v1/me"]);
    } finally {
      quiet.mockRestore();
    }
  });
}

for (const [what, answer] of MEFAILS) {
  test(`the shell's helpers draw a guest with no session cookie when the backend fails with ${what}`, async () => {
    const quiet = spyOn(console, "error").mockImplementation(() => {});
    incoming.set("cookie", "theme=dark");
    globalThis.fetch = (async () => answer()) as unknown as typeof fetch;
    try {
      assert.equal((await getViewer()).user, null);
      assert.equal(await getViewerCard(), null);
      assert.equal((await getCounters()).notifications, 0);
      assert.deepEqual(await getNavigation(), {
        header: [],
        mobile: [],
        account: [],
        footer: [],
      });
    } finally {
      quiet.mockRestore();
      incoming.set("cookie", "sermo.session_token=live");
    }
  });
}
