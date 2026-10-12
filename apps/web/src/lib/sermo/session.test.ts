import { afterEach, mock, test } from "bun:test";
import assert from "node:assert/strict";
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

const { getViewer } = await import("./session");

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

test("any other error is rethrown", async () => {
  const seen = backend(refusal(500, "internal"));
  await assert.rejects(
    getViewer(),
    (error) => error instanceof SermoError && error.code === "internal",
  );
  assert.equal(seen.length, 1);
});

test("a guest answer that is refused again is rethrown", async () => {
  backend(refusal(401, "unauthenticated"), refusal(401, "unauthenticated"));
  await assert.rejects(
    getViewer(),
    (error) => error instanceof SermoError && error.code === "unauthenticated",
  );
});
