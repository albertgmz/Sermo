import { afterEach, mock, test } from "bun:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

// The part of the `auth.me` answer the panel's gate reads.
type Viewer = {
  user: { username: string };
  resolvedPermissions: Record<string, boolean>;
  staff: {
    panel: boolean;
    moderatesEverywhere: boolean;
    moderatedNodeIds: number[];
  };
};

const NO_STAFF = {
  panel: false,
  moderatesEverywhere: false,
  moderatedNodeIds: [],
};
const viewerWith = (
  resolvedPermissions: Record<string, boolean>,
  staff: Partial<Viewer["staff"]> = {},
): Viewer => ({
  user: { username: "a" },
  resolvedPermissions,
  staff: { ...NO_STAFF, ...staff },
});

const MEMBER = viewerWith({});
const SINGLE_FORUM_MODERATOR = viewerWith(
  {},
  { panel: true, moderatedNodeIds: [3] },
);
const PARTIAL_ADMINISTRATOR = viewerWith(
  { "admin.announcements": true },
  { panel: true },
);
const FULL_ADMINISTRATOR = viewerWith(
  { "admin.settings": true, "admin.permissions": true },
  { panel: true, moderatesEverywhere: true },
);

// The backend is the only thing replaced; the proxy, the LITE helpers and
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

// Forums, threads, members and the static pages are asked of the backend, so its answers are faked at
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
const PROFILE = {
  id: 5,
  username: "wren",
  groupTitle: "Members",
  displayGroup: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  about: "",
  avatar: null,
  cover: null,
  postCount: 0,
  reactionScore: 0,
  canPostOnWall: false,
  card: {
    id: 5,
    username: "wren",
    avatar: null,
    frame: null,
    nameColor: null,
    title: "Newcomer",
    badges: [],
    level: 1,
  },
  customTitle: null,
  signatureHtml: null,
  location: "",
  website: "",
  birthday: null,
  socials: { discord: "", telegram: "", x: "" },
  followerCount: 0,
  followingCount: 0,
  credits: 0,
  awardXp: 0,
  level: { level: 1, currentLevelXp: 0, nextLevelXp: 100 },
  awardSlots: 5,
  referralCount: 0,
  lastActivityAt: null,
  viewer: { isFollowing: false, isIgnoring: false },
  seo: NODE.seo,
};
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

test("the panel is a 404 without a session and the backend is not asked", async () => {
  for (const path of [
    "/admin",
    "/admin/anything",
    "/admin/forums",
    "/moderation",
    "/moderation/reports",
  ]) {
    reset();
    isNotFound(await ask(path));
    assert.equal(state.viewerAsked, 0, path);
  }
});

test("a member with nothing in the panel gets a 404 on every address of it, one read each", async () => {
  for (const path of ["/admin", "/admin/anything", "/moderation"]) {
    reset({ viewer: MEMBER });
    isNotFound(await ask(path, { cookie: SESSION }));
    assert.equal(state.viewerAsked, 1, path);
  }
  // A dead cookie or a banned account: the viewer lookup says null.
  reset({ viewer: null });
  isNotFound(await ask("/admin", { cookie: SESSION }));
  assert.equal(state.viewerAsked, 1);
});

test("a moderator of one forum opens the moderation landing and the home, nothing else", async () => {
  for (const path of ["/admin", "/moderation", "/moderation/"]) {
    reset({ viewer: SINGLE_FORUM_MODERATOR });
    passes(await ask(path, { cookie: SESSION }));
    assert.equal(state.viewerAsked, 1, path);
  }
  for (const path of ["/admin/settings", "/admin/does-not-exist"]) {
    reset({ viewer: SINGLE_FORUM_MODERATOR });
    isNotFound(await ask(path, { cookie: SESSION }));
  }
});

test("a partial administrator opens the home and not the moderation landing", async () => {
  reset({ viewer: PARTIAL_ADMINISTRATOR });
  passes(await ask("/admin", { cookie: SESSION }));
  reset({ viewer: PARTIAL_ADMINISTRATOR });
  isNotFound(await ask("/moderation", { cookie: SESSION }));
});

test("a full administrator opens the built screens; unknown and unbuilt addresses are a 404 for them too", async () => {
  for (const path of ["/admin", "/moderation"]) {
    reset({ viewer: FULL_ADMINISTRATOR });
    passes(await ask(path, { cookie: SESSION }));
    assert.equal(state.viewerAsked, 1, path);
  }
  // An address no screen of the registry matches, a record id that cannot be one, a screen the
  // registry lists but nobody has built yet.
  for (const path of [
    "/admin/does-not-exist",
    "/admin/forums/abc/permissions/x",
    "/moderation/nothing",
  ]) {
    reset({ viewer: FULL_ADMINISTRATOR });
    isNotFound(await ask(path, { cookie: SESSION }));
  }
});

test("an address of the panel that cannot be decoded, or that looks like a picture, is still gated", async () => {
  for (const path of [
    "/admin/%E0%A4%A",
    "/moderation/%FF",
    "/admin/pages/a.png",
    "/admin/logo.svg",
  ]) {
    reset();
    isNotFound(await ask(path));
    reset({ viewer: FULL_ADMINISTRATOR });
    isNotFound(await ask(path, { cookie: SESSION }));
  }
});

test("the panel's gate answers an action's POST and a prefetch like a page load", async () => {
  reset({ viewer: MEMBER });
  isNotFound(
    await ask("/admin", {
      cookie: SESSION,
      method: "POST",
      headers: { "next-action": "abc" },
    }),
  );
  reset({ viewer: MEMBER });
  isNotFound(
    await ask("/moderation", {
      cookie: SESSION,
      headers: { "sec-fetch-mode": "cors" },
    }),
  );
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

  const picture = await ask("/pictures/tobi.jpg", { headers: forged });
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

test("a member is a 404 when the backend says the profile is not found, and only then", async () => {
  backend({
    "/api/v1/users/5": Response.json(PROFILE),
    "/api/v1/users/42": Response.json(PROFILE),
  });
  passes(await ask("/members/5"));
  passes(await ask("/members/42"));
  isNotFound(await ask("/members/6"));

  // A private profile is not found for the visitor; the rest of the members stay reachable.
  backend({ "/api/v1/users/5": refusal(404, "not_found") });
  isNotFound(await ask("/members/5"));

  // An outage or a refusal other than not_found lets the page show its own error.
  backend({ "/api/v1/users/5": refusal(500, "internal") });
  passes(await ask("/members/5"));
  backend({ "/api/v1/users/5": refusal(403, "forbidden") });
  passes(await ask("/members/5"));
  backend({ "/api/v1/users/5": "down" });
  passes(await ask("/members/5"));
});

const AWARD = {
  id: 2,
  name: "Pioneer",
  description: "",
  icon: "",
  image: null,
  tier: "gold",
  xp: 10,
  credits: 0,
  isStackable: false,
  isActive: true,
  criteria: [],
  grantCount: 0,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

test("an award is a 404 when the backend says it is not found, and only then", async () => {
  const asked = backend({
    "/api/v1/awards/2": Response.json(AWARD),
    "/api/v1/awards/42": Response.json(AWARD),
  });
  passes(await ask("/awards/2"));
  passes(await ask("/awards/42"));
  isNotFound(await ask("/awards/999"));
  assert.equal(asked.length, 3);

  // An id that cannot exist is a 404 and the backend is not asked.
  const unasked = backend({});
  for (const id of ["0", "03", "abc", "1.5"])
    isNotFound(await ask(`/awards/${id}`));
  assert.equal(unasked.length, 0);

  // An outage or a refusal other than not_found lets the page show its own error.
  backend({ "/api/v1/awards/2": refusal(500, "internal") });
  passes(await ask("/awards/2"));
  backend({ "/api/v1/awards/2": refusal(403, "forbidden") });
  passes(await ask("/awards/2"));
  backend({ "/api/v1/awards/2": "down" });
  passes(await ask("/awards/2"));

  // The list itself is not looked up.
  const list = backend({});
  passes(await ask("/awards"));
  assert.equal(list.length, 0);
});

test("the member list itself is not looked up", async () => {
  const asked = backend({});
  passes(await ask("/members"));
  passes(await ask("/members?view=staff"));
  assert.equal(asked.length, 0);
});

test("a forum id that is not a plain number is a 404 and the backend is not asked", async () => {
  const asked = backend({});
  for (const id of ["0", "03", "abc", "1.5", "1e3", "99999999999999999999"]) {
    isNotFound(await ask(`/forums/${id}`));
    isNotFound(await ask(`/threads/${id}`));
    isNotFound(await ask(`/members/${id}`));
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
      // A thread without posts might have been merged into another: the SEO read tells.
      "/api/v1/seo/threads/8",
    ],
  );

  backend({ "/api/v1/threads/7/posts?limit=1": refusal(500, "internal") });
  passes(await ask("/threads/7"));
});

function seoOf(canonical: string, redirect: boolean) {
  return Response.json({ ...NODE.seo, canonical, redirect });
}

test("a merged thread's address is a permanent redirect to the thread that took its place", async () => {
  const asked = backend({
    "/api/v1/seo/threads/9": seoOf("http://api.example/threads/7-news", true),
    "/api/v1/seo/threads/10": seoOf("http://api.example/threads/10-x", false),
    "/api/v1/seo/threads/11": refusal(500, "internal"),
  });
  const moved = await ask("/threads/9?page=2", { cookie: SESSION });
  assert.ok(moved);
  assert.equal(moved.status, 308);
  assert.equal(moved.headers.get("location"), "http://localhost/threads/7");
  assert.equal(asked[0].url.pathname, "/api/v1/threads/9/posts");
  assert.equal(asked[1].url.pathname, "/api/v1/seo/threads/9");
  assert.equal(asked[1].headers.get("cookie"), SESSION);
  // Not merged and still missing, or hidden from the visitor: a 404. An outage: the page decides.
  isNotFound(await ask("/threads/10"));
  isNotFound(await ask("/threads/12"));
  passes(await ask("/threads/11"));
  // A thread with posts never asks the SEO read.
  const found = backend({
    "/api/v1/threads/7/posts?limit=1": Response.json(NO_POSTS),
  });
  passes(await ask("/threads/7"));
  assert.equal(found.length, 1);
});

test("a prefetch, a soft navigation or an action's POST is not looked up in the backend", async () => {
  const asked = backend({});
  const requests: [string, { headers?: HeadersInit; method?: string }][] = [
    ["/threads/8", { headers: { "sec-fetch-mode": "cors" } }],
    ["/threads/8", { headers: { "sec-fetch-mode": "same-origin" } }],
    ["/threads/8", { headers: { "sec-purpose": "prefetch" } }],
    ["/threads/8", { method: "POST", headers: { "next-action": "abc" } }],
    ["/forums/9", { headers: { "sec-fetch-mode": "cors" } }],
    ["/members/9", { headers: { "sec-fetch-mode": "cors" } }],
    ["/conversations/9", { headers: { "sec-fetch-mode": "cors" } }],
    ["/terms", { headers: { "sec-fetch-mode": "cors" } }],
    ["/pages/nope", { headers: { "sec-fetch-mode": "cors" } }],
  ];
  for (const [path, init] of requests) {
    passes(await ask(path, { cookie: SESSION, ...init }));
  }
  assert.equal(asked.length, 0);

  // A page load keeps its real 404, whether the browser says it navigates or says nothing.
  isNotFound(
    await ask("/threads/8", { headers: { "sec-fetch-mode": "navigate" } }),
  );
  isNotFound(await ask("/forums/9"));
  assert.equal(asked.length, 3);
});

test("a prefetch of a members-only page is still sent to sign in", async () => {
  const asked = backend({});
  const response = await ask("/conversations/5", {
    headers: { "sec-fetch-mode": "cors" },
  });
  assert.equal(response?.status, 307);
  assert.equal(asked.length, 0);
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

test("a document navigation is looked up whatever its sec-purpose says", async () => {
  const asked = backend({});
  isNotFound(
    await ask("/threads/999", {
      headers: {
        "sec-fetch-mode": "navigate",
        "sec-purpose": "prefetch;prerender",
      },
    }),
  );
  assert.equal(asked.length, 2);
});

test("an id that is not plain decimal is a 404 for every kind of request, unasked", async () => {
  const asked = backend({});
  const kinds: { headers?: HeadersInit; method?: string }[] = [
    {},
    { headers: { "sec-fetch-mode": "cors" } },
    { headers: { "sec-fetch-mode": "navigate" } },
    { headers: { "sec-purpose": "prefetch" } },
    { method: "POST", headers: { "next-action": "abc" } },
  ];
  for (const id of ["0x10", "1e2", "+5", " 5", "5.0"]) {
    for (const kind of kinds) {
      isNotFound(await ask(`/threads/${id}`, kind));
      isNotFound(await ask(`/forums/${encodeURIComponent(id)}`, kind));
    }
  }
  assert.equal(asked.length, 0);
});
