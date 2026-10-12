import { mock, test } from "bun:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

type Viewer = { user: { username: string }; permissions: { isAdmin: boolean } };

// The backend and the JSON data are the only things replaced; the proxy, the LITE helpers and
// Next's response classes run unchanged.
const state = {
  viewer: null as Viewer | null,
  viewerAsked: 0,
  twin: null as { id: number } | null,
  conversation: null as unknown,
  conversationAsked: [] as [number, number][],
};
mock.module("server-only", () => ({}));
mock.module("@/lib/sermo/viewer", () => ({
  viewerOf: async () => {
    state.viewerAsked += 1;
    return state.viewer;
  },
}));
mock.module("@/lib/db", () => ({
  getUser: async () => state.twin,
  getUserById: async () => ({ id: 1 }),
  getForum: async () => ({ id: 1 }),
  getAward: async () => ({ id: 1 }),
  getThread: async () => ({ id: 1 }),
  getConversation: async (id: number, viewerId: number) => {
    state.conversationAsked.push([id, viewerId]);
    return state.conversation;
  },
}));

// A private copy of the module: another suite may have loaded the proxy against its own mocks.
const source = "../src/proxy.ts?gates";
const { proxy } = (await import(source)) as typeof import("../src/proxy");

const SESSION = "sermo.session_token=abc";
const SECURE_SESSION = "__Secure-sermo.session_token=abc";

function reset(overrides: Partial<typeof state> = {}) {
  Object.assign(state, {
    viewer: null,
    viewerAsked: 0,
    twin: null,
    conversation: null,
    conversationAsked: [],
    ...overrides,
  });
}

function ask(
  path: string,
  init: { cookie?: string; headers?: HeadersInit; method?: string } = {},
) {
  const headers = new Headers(init.headers);
  if (init.cookie) headers.set("cookie", init.cookie);
  return proxy(
    new NextRequest(`http://localhost${path}`, {
      headers,
      method: init.method,
    }),
  );
}

function isNotFound(response: Response | undefined) {
  assert.ok(response);
  assert.equal(response.status, 404);
  assert.equal(
    response.headers.get("x-middleware-rewrite"),
    "http://localhost/not-found",
  );
}

function passes(response: Response | undefined) {
  assert.ok(response);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-middleware-next"), "1");
  assert.equal(response.headers.get("x-middleware-rewrite"), null);
  assert.equal(response.headers.get("location"), null);
}

// What the proxy forwards to the page, as Next encodes it on the response.
function forwarded(response: Response | undefined, name: string) {
  assert.ok(response);
  const listed = (response.headers.get("x-middleware-override-headers") ?? "")
    .split(",")
    .includes(name);
  const value = response.headers.get(`x-middleware-request-${name}`);
  assert.equal(listed, value !== null);
  return value;
}

test("the API passes through untouched, even when LITE blocks every category", async () => {
  for (const path of [
    "/api/v1/me",
    "/api/auth/sign-in/username",
    "/api/v1/files/12.png",
  ]) {
    reset();
    const response = await ask(path, { cookie: "forum_lite=all" });
    assert.equal(response, undefined, path);
    assert.equal(state.viewerAsked, 0);
  }
});

test("/admin is a 404 without a session and the backend is not asked", async () => {
  for (const path of ["/admin", "/admin/forums"]) {
    reset();
    isNotFound(await ask(path));
    assert.equal(state.viewerAsked, 0, path);
  }
});

test("/admin asks the backend and only an administrator gets in", async () => {
  for (const path of ["/admin", "/admin/forums"]) {
    reset({
      viewer: { user: { username: "a" }, permissions: { isAdmin: false } },
    });
    isNotFound(await ask(path, { cookie: SESSION }));
    assert.equal(state.viewerAsked, 1);

    reset({
      viewer: { user: { username: "a" }, permissions: { isAdmin: true } },
    });
    passes(await ask(path, { cookie: SESSION }));
    assert.equal(state.viewerAsked, 1);

    // A dead cookie or a banned account: the viewer lookup says null.
    reset({ viewer: null });
    isNotFound(await ask(path, { cookie: SESSION }));
    assert.equal(state.viewerAsked, 1);
  }
});

test("a conversation needs a JSON member of the account's username", async () => {
  const viewer = { user: { username: "ann" }, permissions: { isAdmin: false } };

  reset({ viewer, twin: null, conversation: { id: 5 } });
  isNotFound(await ask("/conversations/5", { cookie: SESSION }));
  assert.deepEqual(state.conversationAsked, []);

  reset({ viewer, twin: { id: 9 }, conversation: null });
  isNotFound(await ask("/conversations/5", { cookie: SESSION }));
  assert.deepEqual(state.conversationAsked, [[5, 9]]);

  reset({ viewer, twin: { id: 9 }, conversation: { id: 5 } });
  passes(await ask("/conversations/5", { cookie: SESSION }));
  assert.deepEqual(state.conversationAsked, [[5, 9]]);

  // A dead cookie has no account, so no twin either.
  reset({ viewer: null, twin: { id: 9 }, conversation: { id: 5 } });
  isNotFound(await ask("/conversations/5", { cookie: SESSION }));
});

test("a guest on a members-only page is sent to sign in and back", async () => {
  reset();
  const response = await ask("/account?tab=x");
  assert.ok(response);
  assert.equal(response.status, 307);
  assert.equal(
    response.headers.get("location"),
    "http://localhost/login?next=%2Faccount%3Ftab%3Dx",
  );
});

test("either session cookie counts as having a session", async () => {
  for (const cookie of [SESSION, SECURE_SESSION]) {
    reset();
    passes(await ask("/account?tab=x", { cookie }));
  }
});

test("a page request carries the path and query in x-sermo-path", async () => {
  reset();
  const response = await ask("/forums?page=2");
  passes(response);
  assert.equal(forwarded(response, "x-sermo-path"), "/forums?page=2");
  // The rest of the request is forwarded as it came.
  const kept = await ask("/", { headers: { "user-agent": "agent" } });
  assert.equal(forwarded(kept, "user-agent"), "agent");
});

test("a value the client sent under x-sermo-path is overwritten", async () => {
  reset();
  const response = await ask("/forums", {
    headers: { "x-sermo-path": "//evil.example" },
  });
  assert.equal(forwarded(response, "x-sermo-path"), "/forums");
});

test("an action's POST carries no x-sermo-path, whatever the client sent", async () => {
  reset();
  const response = await ask("/forums", {
    method: "POST",
    headers: { "x-sermo-path": "/forged" },
  });
  passes(response);
  assert.equal(forwarded(response, "x-sermo-path"), null);
});

test("the API, pictures and the 404 rewrites carry no x-sermo-path", async () => {
  reset();
  const forged = { "x-sermo-path": "/forged" };
  assert.equal(await ask("/api/v1/me", { headers: forged }), undefined);

  const picture = await ask("/avatars/tobi.jpg", { headers: forged });
  assert.ok(picture);
  assert.equal(picture.headers.get("x-middleware-next"), "1");
  assert.equal(picture.headers.get("vary"), "Cookie");
  assert.equal(picture.headers.get("x-middleware-override-headers"), null);
  assert.equal(picture.headers.get("x-middleware-request-x-sermo-path"), null);

  const missing = await ask("/forums/abc", { headers: forged });
  isNotFound(missing);
  assert.equal(missing?.headers.get("x-middleware-override-headers"), null);
});

test("the legacy LITE cookie is replaced on a page that carries the header", async () => {
  reset();
  const response = await ask("/forums", { cookie: "forum_lite=1" });
  assert.equal(forwarded(response, "x-sermo-path"), "/forums");
  assert.ok(response?.headers.get("set-cookie")?.includes("forum_lite=all"));
});
