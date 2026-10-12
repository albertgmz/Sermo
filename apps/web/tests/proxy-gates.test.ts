import { afterEach, mock, test } from "bun:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

type Viewer = { user: { username: string }; permissions: { isAdmin: boolean } };

// The backend and the JSON data are the only things replaced; the proxy, the LITE helpers and
// Next's response classes run unchanged.
const state = {
  viewer: null as Viewer | null,
  viewerAsked: 0,
};
mock.module("server-only", () => ({}));
mock.module("@/lib/sermo/viewer", () => ({
  viewerOf: async () => {
    state.viewerAsked += 1;
    return state.viewer;
  },
}));
mock.module("@/lib/db", () => ({
  getUserById: async () => ({ id: 1 }),
  getAward: async () => ({ id: 1 }),
}));

// Forums, threads and the static pages are asked of the backend, so its answers are faked at
// `fetch`: the real client builds the requests and checks the answers.
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

type Asked = { method: string; url: URL; headers: Headers };

// Answers by path; a missing entry is the backend refusing with not_found.
function backend(answers: Record<string, Response | "down">): Asked[] {
  const asked: Asked[] = [];
  globalThis.fetch = (async (input: string, init: RequestInit) => {
    const url = new URL(input);
    asked.push({
      method: init.method ?? "GET",
      url,
      headers: new Headers(init.headers),
    });
    const answer = answers[url.pathname + url.search];
    if (answer === "down") throw new Error("connection refused");
    return answer ?? refusal(404, "not_found");
  }) as unknown as typeof fetch;
  return asked;
}

const refusal = (status: number, code: string) =>
  Response.json({ error: { code, message: code } }, { status });

const NODE = {
  node: {
    id: 3,
    parentId: null,
    type: "forum",
    title: "General",
    description: "",
    icon: null,
    cover: null,
    position: 0,
    tabId: null,
    depth: 0,
    threadCount: 0,
    postCount: 0,
    lastPost: null,
    permissions: { canPost: false, canModerate: false },
    settings: {
      requireThreadApproval: false,
      requireReplyApproval: false,
      isReadOnly: false,
      minAccountAgeDays: 0,
      minPostCount: 0,
    },
  },
  seo: {
    title: "General",
    description: "",
    canonical: "http://localhost/forums/3",
    robots: "index,follow",
    redirect: false,
    jsonLd: [],
  },
  breadcrumbs: [],
  resolvedPermissions: {},
};
const NO_POSTS = { items: [], nextCursor: null };
const CONVERSATION = {
  id: 5,
  title: "Seed swap",
  starter: { id: 1, username: "ember" },
  createdAt: "2026-01-01T00:00:00.000Z",
  lastMessage: {
    messageId: 1,
    sentAt: "2026-01-01T00:00:00.000Z",
    user: { id: 1, username: "ember" },
  },
  messageCount: 1,
  participantCount: 2,
  isUnread: false,
  participants: [
    { user: { id: 1, username: "ember" }, state: "active" },
    { user: { id: 2, username: "wren" }, state: "active" },
  ],
  canReply: true,
};
const PAGE = {
  slug: "terms",
  title: "Terms",
  bodyHtml: "<p>Terms</p>",
  isPublished: true,
  updatedAt: "2026-01-01T00:00:00.000Z",
};

// A private copy of the module: another suite may have loaded the proxy against its own mocks.
const source = "../src/proxy.ts?gates";
const { proxy } = (await import(source)) as typeof import("../src/proxy");

const SESSION = "sermo.session_token=abc";
const SECURE_SESSION = "__Secure-sermo.session_token=abc";

function reset(overrides: Partial<typeof state> = {}) {
  Object.assign(state, {
    viewer: null,
    viewerAsked: 0,
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

test("a conversation is a 404 when the backend says the visitor has none like it, and only then", async () => {
  reset();
  const asked = backend({
    "/api/v1/conversations/5": Response.json(CONVERSATION),
    "/api/v1/conversations/6": refusal(500, "internal"),
    "/api/v1/conversations/7": refusal(403, "forbidden"),
  });
  passes(await ask("/conversations/5", { cookie: SESSION }));
  // Not a participant: the backend does not tell it from a conversation that does not exist.
  isNotFound(await ask("/conversations/9", { cookie: SESSION }));
  // Any other answer lets the page show its own error.
  passes(await ask("/conversations/6", { cookie: SESSION }));
  passes(await ask("/conversations/7", { cookie: SESSION }));
  assert.equal(asked[0].headers.get("cookie"), SESSION);
  // The JSON data and the viewer lookup play no part in it.
  assert.equal(state.viewerAsked, 0);

  backend({ "/api/v1/conversations/5": "down" });
  passes(await ask("/conversations/5", { cookie: SESSION }));
});

test("a conversation id that is not a plain number is a 404 and the backend is not asked", async () => {
  const asked = backend({});
  for (const id of ["0", "03", "abc", "1.5", "99999999999999999999"]) {
    isNotFound(await ask(`/conversations/${id}`, { cookie: SESSION }));
  }
  assert.equal(asked.length, 0);
});

test("the new conversation form is not looked up as a conversation", async () => {
  const asked = backend({});
  passes(await ask("/conversations/new", { cookie: SESSION }));
  assert.equal(asked.length, 0);
});

test("a guest on a conversation is sent to sign in before the backend is asked", async () => {
  const asked = backend({});
  const response = await ask("/conversations/5");
  assert.ok(response);
  assert.equal(response.status, 307);
  assert.equal(
    response.headers.get("location"),
    "http://localhost/login?next=%2Fconversations%2F5",
  );
  assert.equal(asked.length, 0);
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

test("a forum is a 404 when the backend says it is not found, and only then", async () => {
  backend({
    "/api/v1/nodes/3": Response.json(NODE),
    "/api/v1/nodes/42": Response.json(NODE),
  });
  passes(await ask("/forums/3"));
  passes(await ask("/forums/42"));
  isNotFound(await ask("/forums/4"));

  // An outage or a refusal other than not_found lets the page show its own error.
  backend({ "/api/v1/nodes/3": refusal(500, "internal") });
  passes(await ask("/forums/3"));
  backend({ "/api/v1/nodes/3": refusal(403, "forbidden") });
  passes(await ask("/forums/3"));
  backend({ "/api/v1/nodes/3": "down" });
  passes(await ask("/forums/3"));
});

test("a forum id that is not a plain number is a 404 and the backend is not asked", async () => {
  const asked = backend({});
  for (const id of ["0", "03", "abc", "1.5", "1e3", "99999999999999999999"]) {
    isNotFound(await ask(`/forums/${id}`));
    isNotFound(await ask(`/threads/${id}`));
  }
  assert.equal(asked.length, 0);
});

test("a thread is proven by one post, never by reading the thread (which counts a view)", async () => {
  const asked = backend({
    "/api/v1/threads/7/posts?limit=1": Response.json(NO_POSTS),
    "/api/v1/threads/345/posts?limit=1": Response.json(NO_POSTS),
  });
  passes(await ask("/threads/7"));
  passes(await ask("/threads/345"));
  isNotFound(await ask("/threads/8"));
  assert.deepEqual(
    asked.map((entry) => entry.url.pathname + entry.url.search),
    [
      "/api/v1/threads/7/posts?limit=1",
      "/api/v1/threads/345/posts?limit=1",
      "/api/v1/threads/8/posts?limit=1",
    ],
  );

  backend({ "/api/v1/threads/7/posts?limit=1": refusal(500, "internal") });
  passes(await ask("/threads/7"));
});

test("the backend is asked as the visitor", async () => {
  const asked = backend({ "/api/v1/nodes/3": Response.json(NODE) });
  await ask("/forums/3", {
    cookie: `${SESSION}; theme=dark`,
    headers: {
      "user-agent": "agent/1",
      "x-forwarded-for": "203.0.113.9, 198.51.100.4",
    },
  });
  assert.equal(asked.length, 1);
  assert.equal(asked[0].headers.get("cookie"), SESSION);
  assert.equal(asked[0].headers.get("user-agent"), "agent/1");
  assert.equal(asked[0].headers.get("x-forwarded-for"), "198.51.100.4");
});

test("the static pages are a 404 while the backend does not have them", async () => {
  backend({ "/api/v1/pages/terms": Response.json(PAGE) });
  passes(await ask("/terms"));
  isNotFound(await ask("/privacy"));
  isNotFound(await ask("/legal"));
  isNotFound(await ask("/contact"));
});

test("/pages/<slug> asks for that slug, and a slug that cannot exist is a 404 unasked", async () => {
  const asked = backend({
    "/api/v1/pages/about": Response.json({ ...PAGE, slug: "about" }),
  });
  passes(await ask("/pages/about"));
  isNotFound(await ask("/pages/missing"));
  isNotFound(await ask("/pages/Not_A_Slug"));
  assert.deepEqual(
    asked.map((entry) => entry.url.pathname),
    ["/api/v1/pages/about", "/api/v1/pages/missing"],
  );

  backend({ "/api/v1/pages/about": "down" });
  passes(await ask("/pages/about"));
});

test("only the exact static paths are looked up", async () => {
  const asked = backend({});
  passes(await ask("/"));
  passes(await ask("/forums"));
  passes(await ask("/search"));
  assert.equal(asked.length, 0);
});
