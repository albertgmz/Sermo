import { afterEach, mock, spyOn, test } from "bun:test";
import assert from "node:assert/strict";
import { authCounters } from "@sermo/core/contracts";
import { SermoError } from "./errors";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const incoming = new Headers({
  cookie: "theme=dark; sermo.session_token=dead",
  "user-agent": "agent/1",
  "x-forwarded-for": "203.0.113.9, 198.51.100.4",
});
mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  headers: async () => incoming,
  cookies: async () => ({ set: () => {} }),
}));

const { call, sessionUnconfirmed, unconfirmedKind } = await import("./client");
const { getMember, getViewer } = await import("./session");

const guest = {
  user: null,
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
const member = {
  ...guest,
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
    feedView: "cards",
    openHomeTab: "latest",
    pendingAcceptance: [],
    awaitingApproval: false,
  },
};

// Answers each call in turn and records what was sent.
function backend(...answers: Response[]) {
  const seen: Headers[] = [];
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    seen.push(new Headers(init.headers));
    const next = answers[seen.length - 1];
    if (!next) throw new Error("unexpected extra call");
    return next;
  }) as unknown as typeof fetch;
  return seen;
}

const refusal = (status: number, code: string) =>
  Response.json({ error: { code, message: code } }, { status });

test("the backend's answer is the viewer", async () => {
  const seen = backend(Response.json(member));
  const viewer = await getViewer();
  assert.equal(viewer.user?.username, "ann");
  assert.equal(seen.length, 1);
  assert.equal(seen[0].get("cookie"), "sermo.session_token=dead");
});

for (const [status, code] of [
  [401, "unauthenticated"],
  [403, "forbidden"],
] as const) {
  test(`a ${code} answer is asked again as a guest, still as this visitor`, async () => {
    const seen = backend(refusal(status, code), Response.json(guest));
    const viewer = await getViewer();
    assert.equal(viewer.user, null);
    assert.equal(seen.length, 2);
    assert.equal(seen[1].get("cookie"), null);
    assert.equal(seen[1].get("user-agent"), "agent/1");
    assert.equal(seen[1].get("x-forwarded-for"), "198.51.100.4");
  });
}

// What auth.me can do wrong that is not the backend's answer about the session.
const FAILURES: [string, () => Promise<Response>][] = [
  ["a throttled read", async () => refusal(429, "rate_limited")],
  ["a server error", async () => refusal(500, "internal")],
  ["an outage", async () => refusal(503, "internal")],
  [
    "a connection that fails",
    async () => {
      throw new TypeError("fetch failed");
    },
  ],
  ["an answer that breaks the contract", async () => Response.json({ x: 1 })],
];

for (const [what, answer] of FAILURES) {
  test(`${what} on auth.me draws a guest, keeps the cookie and asks nothing more`, async () => {
    const quiet = spyOn(console, "error").mockImplementation(() => {});
    const seen: Headers[] = [];
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      seen.push(new Headers(init.headers));
      return answer();
    }) as unknown as typeof fetch;
    try {
      const viewer = await getViewer();
      assert.equal(viewer.user, null);
      assert.equal(viewer.staff.panel, false);
      assert.equal(await sessionUnconfirmed(), true);
      // The page's own reads still go out as the visitor, session cookie included.
      globalThis.fetch = (async (_url: string, init: RequestInit) => {
        seen.push(new Headers(init.headers));
        return Response.json({
          conversations: 0,
          notifications: 0,
          openReports: { count: 0, more: false, cap: 99 },
          pendingApprovals: { count: 0, more: false, cap: 99 },
          pendingSignups: { count: 0, more: false, cap: 99 },
        });
      }) as unknown as typeof fetch;
      await call(authCounters, {});
      assert.equal(seen.at(-1)?.get("cookie"), "sermo.session_token=dead");
    } finally {
      quiet.mockRestore();
    }
  });

  test(`${what} on auth.me makes a members-only page fail instead of sending the member to sign in`, async () => {
    const quiet = spyOn(console, "error").mockImplementation(() => {});
    globalThis.fetch = (async () => answer()) as unknown as typeof fetch;
    try {
      await assert.rejects(getMember(), (error) => {
        assert.ok(error instanceof SermoError);
        assert.equal(error.code, "internal");
        return true;
      });
    } finally {
      quiet.mockRestore();
    }
  });
}

test("a confirmed session is not marked, and a member passes a members-only page", async () => {
  backend(Response.json(member));
  assert.equal(await sessionUnconfirmed(), false);
  // Outside a render nothing is shared, so the check and the viewer each ask.
  backend(Response.json(member), Response.json(member));
  assert.equal((await getMember()).user?.username, "ann");
});

test("a dead cookie is a confirmed guest, not an unconfirmed one", async () => {
  backend(refusal(401, "unauthenticated"), Response.json(guest));
  assert.equal(await sessionUnconfirmed(), false);
});

test("a guest answer that is refused again is rethrown", async () => {
  backend(refusal(401, "unauthenticated"), refusal(401, "unauthenticated"));
  await assert.rejects(
    getViewer(),
    (error) => error instanceof SermoError && error.code === "unauthenticated",
  );
});

// A visitor with no session cookie is a guest the backend never has to check; when the backend
// cannot be reached the shell still needs a viewer.
test("a guest with no cookie, backend down: the viewer is a guest and the outage is known", async () => {
  incoming.set("cookie", "theme=dark");
  const quiet = spyOn(console, "error").mockImplementation(() => {});
  try {
    for (const [, answer] of FAILURES) {
      globalThis.fetch = (async () => answer()) as unknown as typeof fetch;
      const viewer = await getViewer();
      assert.equal(viewer.user, null);
      assert.equal(viewer.staff.panel, false);
      assert.equal(await unconfirmedKind(), "site");
      assert.equal(await sessionUnconfirmed(), true);
    }
  } finally {
    quiet.mockRestore();
    incoming.set("cookie", "theme=dark; sermo.session_token=dead");
  }
});

test("a guest with no cookie and a backend that answers is not marked", async () => {
  incoming.set("cookie", "theme=dark");
  try {
    backend(Response.json(guest));
    assert.equal(await unconfirmedKind(), null);
  } finally {
    incoming.set("cookie", "theme=dark; sermo.session_token=dead");
  }
});
