import { afterEach, mock, test } from "bun:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { SermoError } from "../src/lib/sermo/errors";

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
  // When set, the viewer read fails with this instead of answering.
  fail: null as (() => Promise<never>) | null,
  // The site's default language, and how often the proxy asked for it.
  siteDefault: "en",
  defaultAsked: 0,
};
mock.module("@/lib/sermo/default-language", () => ({
  siteDefaultLanguage: async () => {
    state.defaultAsked += 1;
    return state.siteDefault;
  },
  siteConsentFacts: async () => ({
    cookiePolicyVersion: 1,
    bannerOutsideEu: true,
  }),
  forgetDefaultLanguage: () => {},
}));
mock.module("server-only", () => ({}));
mock.module("@/lib/sermo/viewer", () => ({
  viewerOf: async () => {
    if (state.fail) return state.fail();
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

// Answers by path (with the query when the entry names it); a missing entry is the backend refusing with not_found.
function backend(answers: Record<string, Response | "down">): Asked[] {
  const asked: Asked[] = [];
  globalThis.fetch = (async (input: string, init: RequestInit) => {
    const url = new URL(input);
    asked.push({
      method: init.method ?? "GET",
      url,
      headers: new Headers(init.headers),
    });
    const answer = answers[url.pathname + url.search] ?? answers[url.pathname];
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
// What the SEO reads answer: the address the backend holds for the page, and whether the
// address that was asked for is another.
function seoOf(canonical: string, redirect: boolean) {
  return Response.json({ ...NODE.seo, canonical, redirect });
}
const FORUM_3 = seoOf("http://localhost/forums/3-general", false);
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
  canInvite: true,
  canRename: true,
  isLocked: false,
  canLock: true,
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
const { proxy, config } = (await import(
  source
)) as typeof import("../src/proxy");

const SESSION = "sermo.session_token=abc";
const SECURE_SESSION = "__Secure-sermo.session_token=abc";

function reset(overrides: Partial<typeof state> = {}) {
  Object.assign(state, {
    viewer: null,
    viewerAsked: 0,
    fail: null,
    siteDefault: "en",
    defaultAsked: 0,
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

function isNotFound(response: Response | undefined, label?: string) {
  assert.ok(response);
  assert.equal(response.status, 404, label);
  assert.equal(
    response.headers.get("x-middleware-rewrite"),
    "http://localhost/en/not-found",
  );
}

// The request goes on to its page, rewritten inside the server to the hidden language segment.
function passes(response: Response | undefined, target?: string) {
  assert.ok(response);
  assert.equal(response.status, 200);
  const rewrite = response.headers.get("x-middleware-rewrite");
  assert.ok(rewrite);
  assert.notEqual(rewrite, "http://localhost/en/not-found");
  assert.ok(new URL(rewrite).pathname.match(/^\/(en|es)(\/|$)/));
  if (target !== undefined) assert.equal(rewrite, target);
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

test("the bookmarks page is members-only", async () => {
  reset();
  const response = await ask("/account/bookmarks?cursor=abc");
  assert.ok(response);
  assert.equal(response.status, 307);
  assert.equal(
    response.headers.get("location"),
    "http://localhost/login?next=%2Faccount%2Fbookmarks%3Fcursor%3Dabc",
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
  assert.equal(picture.headers.get("x-middleware-override-headers"), null);
  assert.equal(picture.headers.get("x-middleware-request-x-sermo-path"), null);

  const missing = await ask("/forums/abc", { headers: forged });
  isNotFound(missing);
  assert.equal(missing?.headers.get("x-middleware-override-headers"), null);
});

test("the old LITE mode addresses go to the Data saver ones with a 308, keeping the query", async () => {
  reset();
  for (const [from, to] of [
    ["/lite", "/data-saver"],
    ["/lite?saved=1", "/data-saver?saved=1"],
    ["/account/lite", "/account/data-saver"],
    ["/account/lite?saved=1", "/account/data-saver?saved=1"],
    // A language in the address goes in the same single hop, and is not kept in it.
    ["/es/lite", "/data-saver"],
    ["/en/lite?saved=1", "/data-saver?saved=1"],
    ["/es/account/lite?x=1", "/account/data-saver?x=1"],
  ]) {
    for (const cookie of [undefined, SESSION]) {
      const response = await ask(from, { cookie });
      assert.ok(response, from);
      assert.equal(response.status, 308, from);
      assert.equal(response.headers.get("location"), `http://localhost${to}`);
    }
  }
  // The new addresses are pages, not redirects.
  passes(await ask("/data-saver"));
  passes(await ask("/account/data-saver", { cookie: SESSION }));
  // An action posts to the page it is on: nothing is redirected.
  const posted = await ask("/lite", { method: "POST" });
  assert.notEqual(posted?.status, 308);
});

test("a blocked picture address answers with the placeholder in the visitor's language", async () => {
  reset();
  const english = await ask("/pictures/tobi.jpg", { cookie: "forum_lite=all" });
  assert.ok((await english?.text())?.includes(">DATA SAVER<"));
  const spanish = await ask("/pictures/tobi.jpg", {
    cookie: "forum_lite=all; forum_locale=es",
  });
  assert.ok((await spanish?.text())?.includes(">AHORRO DE DATOS<"));
});

test("the legacy LITE cookie is replaced on a page that carries the header", async () => {
  reset();
  const response = await ask("/forums", { cookie: "forum_lite=1" });
  assert.equal(forwarded(response, "x-sermo-path"), "/forums");
  assert.ok(response?.headers.get("set-cookie")?.includes("forum_lite=all"));
});

test("a forum is a 404 when the backend says it is not found, and only then", async () => {
  backend({
    "/api/v1/seo/nodes/3": FORUM_3,
    "/api/v1/seo/nodes/42": seoOf("http://localhost/forums/42-x", false),
  });
  passes(await ask("/forums/3-general"));
  passes(await ask("/forums/42-x"));
  isNotFound(await ask("/forums/4-y"));

  // An outage or a refusal other than not_found lets the page show its own error.
  backend({ "/api/v1/seo/nodes/3": refusal(500, "internal") });
  passes(await ask("/forums/3-general"));
  backend({ "/api/v1/seo/nodes/3": refusal(403, "forbidden") });
  passes(await ask("/forums/3-general"));
  backend({ "/api/v1/seo/nodes/3": "down" });
  passes(await ask("/forums/3-general"));
});

test("a member is a 404 when the backend says the profile is not found, and only then", async () => {
  backend({
    "/api/v1/seo/users/5": seoOf("http://localhost/members/5-wren", false),
    "/api/v1/seo/users/42": seoOf("http://localhost/members/42-x", false),
  });
  passes(await ask("/members/5-wren"));
  passes(await ask("/members/42-x"));
  isNotFound(await ask("/members/6-z"));

  // A private profile is not found for the visitor; the rest of the members stay reachable.
  backend({ "/api/v1/seo/users/5": refusal(404, "not_found") });
  isNotFound(await ask("/members/5-wren"));

  // An outage or a refusal other than not_found lets the page show its own error.
  backend({ "/api/v1/seo/users/5": refusal(500, "internal") });
  passes(await ask("/members/5-wren"));
  backend({ "/api/v1/seo/users/5": refusal(403, "forbidden") });
  passes(await ask("/members/5-wren"));
  backend({ "/api/v1/seo/users/5": "down" });
  passes(await ask("/members/5-wren"));
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
  rule: { match: "all", conditions: [] },
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
  for (const id of [
    "0",
    "03",
    "abc",
    "1.5",
    "1e3",
    "12abc",
    "0x10-x",
    "99999999999999999999",
    "99999999999999999999-x",
  ]) {
    isNotFound(await ask(`/forums/${id}`));
    isNotFound(await ask(`/threads/${id}`));
    isNotFound(await ask(`/members/${id}`));
  }
  assert.equal(asked.length, 0);
});

test("a thread is proven by one SEO read, never by reading the thread (which counts a view)", async () => {
  const asked = backend({
    "/api/v1/seo/threads/7": seoOf("http://localhost/threads/7-news", false),
    "/api/v1/seo/threads/345": seoOf("http://localhost/threads/345-x", false),
  });
  passes(await ask("/threads/7-news"));
  passes(await ask("/threads/345-x"));
  isNotFound(await ask("/threads/8-gone"));
  assert.deepEqual(
    asked.map((entry) => entry.url.pathname),
    [
      "/api/v1/seo/threads/7",
      "/api/v1/seo/threads/345",
      "/api/v1/seo/threads/8",
    ],
  );

  backend({ "/api/v1/seo/threads/7": refusal(500, "internal") });
  passes(await ask("/threads/7-news"));
});

test("a merged thread's address is a permanent redirect to the thread that took its place", async () => {
  const asked = backend({
    "/api/v1/seo/threads/9": seoOf("http://api.example/threads/7-news", true),
    "/api/v1/seo/threads/10": seoOf("http://api.example/threads/10-x", false),
    "/api/v1/seo/threads/11": refusal(500, "internal"),
  });
  const moved = await ask("/threads/9-old?page=2", { cookie: SESSION });
  assert.ok(moved);
  assert.equal(moved.status, 308);
  assert.equal(
    moved.headers.get("location"),
    "http://localhost/threads/7-news?page=2",
  );
  assert.equal(asked.length, 1);
  assert.equal(asked[0].url.pathname, "/api/v1/seo/threads/9");
  assert.equal(asked[0].headers.get("cookie"), SESSION);
  // Hidden from the visitor or missing: a 404. An outage: the page decides.
  passes(await ask("/threads/10-x"));
  isNotFound(await ask("/threads/12"));
  passes(await ask("/threads/11"));
});

// The page reads the backend is asked for a page load, by the address that was asked for.
function seoQuery(asked: { url: URL }[]) {
  return asked.map((entry) => ({
    path: entry.url.pathname,
    requestedPath: entry.url.searchParams.get("requestedPath"),
    page: entry.url.searchParams.get("page"),
  }));
}

test("an address that is not the canonical one is a 308 to it, with the one read a page load always made", async () => {
  const cases: [string, string, string, string][] = [
    // [asked, backend's canonical, read made, redirect to]
    [
      "/threads/7",
      "http://localhost/threads/7-news",
      "/api/v1/seo/threads/7",
      "/threads/7-news",
    ],
    [
      "/threads/7-wrong",
      "http://localhost/threads/7-news",
      "/api/v1/seo/threads/7",
      "/threads/7-news",
    ],
    [
      "/members/5",
      "http://localhost/members/5-wren",
      "/api/v1/seo/users/5",
      "/members/5-wren",
    ],
    [
      "/forums/3",
      "http://localhost/forums/3-general",
      "/api/v1/seo/nodes/3",
      "/forums/3-general",
    ],
    [
      "/forums/3-stale",
      "http://localhost/forums/3-general",
      "/api/v1/seo/nodes/3",
      "/forums/3-general",
    ],
  ];
  for (const [path, canonical, read, to] of cases) {
    const asked = backend({ [read]: seoOf(canonical, true) });
    const response = await ask(path);
    assert.ok(response, path);
    assert.equal(response.status, 308, path);
    assert.equal(
      response.headers.get("location"),
      `http://localhost${to}`,
      path,
    );
    assert.equal(asked.length, 1, path);
    assert.equal(asked[0].url.pathname, read);
  }
});

test("the backend is asked for the address as it will be served, forums under the backend's name", async () => {
  const asked = backend({
    "/api/v1/seo/nodes/3": FORUM_3,
    "/api/v1/seo/threads/7": seoOf(
      "http://localhost/threads/7-news?page=3",
      false,
    ),
    "/api/v1/seo/users/5": seoOf("http://localhost/members/5-wren", false),
  });
  passes(await ask("/forums/3-general"));
  passes(await ask("/threads/7-news"));
  passes(await ask("/threads/7-news?page=3&cursor=abc"));
  passes(await ask("/threads/7-news?page=0"));
  passes(await ask("/members/5-wren"));
  assert.deepEqual(seoQuery(asked), [
    {
      path: "/api/v1/seo/nodes/3",
      requestedPath: "/forums/3-general",
      page: null,
    },
    {
      path: "/api/v1/seo/threads/7",
      requestedPath: "/threads/7-news",
      page: "1",
    },
    {
      path: "/api/v1/seo/threads/7",
      requestedPath: "/threads/7-news?page=3",
      page: "3",
    },
    {
      path: "/api/v1/seo/threads/7",
      requestedPath: "/threads/7-news",
      page: "1",
    },
    {
      path: "/api/v1/seo/users/5",
      requestedPath: "/members/5-wren",
      page: null,
    },
  ]);
});

test("a sub-route is held to no slug, and only a merge moves it", async () => {
  const asked = backend({
    "/api/v1/seo/threads/7": seoOf("http://localhost/threads/7-news", false),
    "/api/v1/seo/threads/9": seoOf("http://localhost/threads/7-news", true),
    "/api/v1/seo/nodes/3": FORUM_3,
  });
  passes(await ask("/threads/7/edit/12", { cookie: SESSION }));
  passes(await ask("/threads/7-wrong/edit/12", { cookie: SESSION }));
  passes(await ask("/forums/3/new", { cookie: SESSION }));
  const moved = await ask("/threads/9/edit/12", { cookie: SESSION });
  assert.equal(moved?.status, 308);
  assert.equal(
    moved?.headers.get("location"),
    "http://localhost/threads/7-news",
  );
  assert.deepEqual(
    seoQuery(asked).map((entry) => entry.requestedPath),
    ["", "", "", ""],
  );
});

test("an address under the old name for forums is a 308 to the current one, whatever follows", async () => {
  const asked = backend({});
  for (const [from, to] of [
    ["/nodes/3-general", "/forums/3-general"],
    ["/nodes/3", "/forums/3"],
    ["/nodes/3/new?x=1", "/forums/3/new?x=1"],
    ["/nodes", "/forums"],
  ]) {
    const response = await ask(from);
    assert.equal(response?.status, 308, from);
    assert.equal(
      response?.headers.get("location"),
      `http://localhost${to}`,
      from,
    );
  }
  assert.equal(asked.length, 0);
  // A name that only starts like it is nothing special.
  passes(await ask("/nodesx"));
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
  assert.equal(asked.length, 2);
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
  const asked = backend({ "/api/v1/seo/nodes/3": FORUM_3 });
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
  assert.equal(asked.length, 1);
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

test("a picture-looking address under the moderation panel is the gate's 404, in any spelling, for a guest with LITE on", async () => {
  for (const path of [
    "/moderation/reports/5.png",
    "/%6Doderation/reports/5.png",
    "/MODERATION/reports/5.png",
    "/Moderation./reports/5.png",
    "/admin/users/5.png",
    "/%41dmin/users/5.png",
  ]) {
    reset();
    isNotFound(await ask(path, { cookie: "forum_lite=all" }), path);
    assert.equal(state.viewerAsked, 0, path);
    // And for a member with nothing in the panel.
    reset({ viewer: MEMBER });
    isNotFound(await ask(path, { cookie: `${SESSION}; forum_lite=all` }));
  }
});

test("a record id that cannot be one is the gate's 404 on a numeric detail screen, for an administrator", async () => {
  for (const path of [
    "/admin/users/abc",
    "/admin/users/0",
    "/admin/users/012",
    "/admin/users/1e3",
    "/admin/forums/-1/permissions",
    "/admin/groups/x",
    "/admin/promotions/1.5",
    "/moderation/reports/abc",
  ]) {
    reset({ viewer: FULL_ADMINISTRATOR });
    isNotFound(await ask(path, { cookie: SESSION }));
  }
});

test("the styleguide is a 404 for a guest and a member without a panel, and opens for staff", async () => {
  for (const path of ["/ui", "/ui/", "/%75i", "/ui/%FF"]) {
    reset();
    isNotFound(await ask(path), path);
    assert.equal(state.viewerAsked, 0, path);
    reset({ viewer: MEMBER });
    isNotFound(await ask(path, { cookie: SESSION }), path);
    // A dead cookie or a banned account is a guest.
    reset({ viewer: null });
    isNotFound(await ask(path, { cookie: SESSION }), path);
  }
  for (const viewer of [
    SINGLE_FORUM_MODERATOR,
    PARTIAL_ADMINISTRATOR,
    FULL_ADMINISTRATOR,
  ]) {
    reset({ viewer });
    passes(await ask("/ui", { cookie: SESSION }));
    assert.equal(state.viewerAsked, 1);
  }
  // A page like /uikit is not the styleguide.
  reset();
  passes(await ask("/uikit"));
});

test("the styleguide is gated for a prefetch and an action's POST too", async () => {
  reset({ viewer: MEMBER });
  isNotFound(
    await ask("/ui", {
      cookie: SESSION,
      headers: { "sec-fetch-mode": "cors" },
    }),
  );
  isNotFound(
    await ask("/ui", {
      cookie: SESSION,
      method: "POST",
      headers: { "next-action": "abc" },
    }),
  );
});

test("a panel address is let through to its page when the viewer read fails, the styleguide is not", async () => {
  reset({
    fail: async () => {
      throw new SermoError("internal", 500, "down");
    },
  });
  passes(await ask("/admin", { cookie: SESSION }));
  passes(await ask("/moderation/reports", { cookie: SESSION }));
  isNotFound(await ask("/ui", { cookie: SESSION }));
  // Without a session there is nothing to ask: a guest still gets the 404.
  isNotFound(await ask("/admin"));
});

// The language of a request -------------------------------------------------------------------

const rewriteOf = (response: Response | undefined) =>
  response?.headers.get("x-middleware-rewrite");

test("the language cookie wins over the browser's language", async () => {
  reset();
  assert.equal(
    rewriteOf(
      await ask("/forums", {
        cookie: "forum_locale=en",
        headers: { "accept-language": "es-ES,es;q=0.9" },
      }),
    ),
    "http://localhost/en/forums",
  );
  assert.equal(
    rewriteOf(
      await ask("/forums", {
        cookie: "forum_locale=es",
        headers: { "accept-language": "en-US" },
      }),
    ),
    "http://localhost/es/forums",
  );
});

test("a cookie that names no supported language is ignored", async () => {
  reset();
  assert.equal(
    rewriteOf(
      await ask("/forums", {
        cookie: "forum_locale=fr",
        headers: { "accept-language": "es" },
      }),
    ),
    "http://localhost/es/forums",
  );
});

test("the browser's language is negotiated by preference, then English", async () => {
  const cases: [string | undefined, string][] = [
    ["es-ES,es;q=0.9,en;q=0.8", "es"],
    ["fr-FR,fr;q=0.9", "en"],
    ["en-US,es;q=0.5", "en"],
    ["fr,es;q=0.4,en;q=0.2", "es"],
    ["es;q=0,en", "en"],
    ["ES", "es"],
    ["*", "en"],
    ["???;;;q==,,,", "en"],
    ["", "en"],
    [undefined, "en"],
  ];
  for (const [header, expected] of cases) {
    reset();
    const response = await ask("/forums", {
      headers: header === undefined ? {} : { "accept-language": header },
    });
    assert.equal(
      rewriteOf(response),
      `http://localhost/${expected}/forums`,
      String(header),
    );
  }
});

test("the rewrite keeps the query, and the root is the language's root", async () => {
  reset();
  const response = await ask("/forums?page=2&sort=new", {
    headers: { "accept-language": "es" },
  });
  assert.equal(
    rewriteOf(response),
    "http://localhost/es/forums?page=2&sort=new",
  );
  assert.equal(rewriteOf(await ask("/")), "http://localhost/en");
  assert.equal(forwarded(response, "x-sermo-path"), "/forums?page=2&sort=new");
});

test("an address that carries the language segment is a 307 to the one without it", async () => {
  reset();
  for (const [path, target] of [
    ["/es/threads/1", "http://localhost/threads/1"],
    ["/en/threads/1?page=2", "http://localhost/threads/1?page=2"],
    ["/es", "http://localhost/"],
    ["/en", "http://localhost/"],
    ["/en/admin", "http://localhost/admin"],
  ]) {
    const response = await ask(path);
    assert.equal(response?.status, 307, path);
    assert.equal(response?.headers.get("location"), target, path);
  }
  // A POST keeps its method through a 307.
  const post = await ask("/es/forums", { method: "POST" });
  assert.equal(post?.status, 307);
  // Segments that only start like a language are pages.
  passes(await ask("/english"), "http://localhost/en/english");
  passes(await ask("/espana"), "http://localhost/en/espana");
});

test("the gates work on the public address, in either language", async () => {
  reset();
  const login = await ask("/account", {
    headers: { "accept-language": "es" },
  });
  assert.equal(
    login?.headers.get("location"),
    "http://localhost/login?next=%2Faccount",
  );
  reset({ viewer: MEMBER });
  const hidden = await ask("/admin", {
    cookie: `${SESSION}; forum_locale=es`,
  });
  assert.equal(hidden?.status, 404);
  assert.equal(rewriteOf(hidden), "http://localhost/es/not-found");
  reset({ viewer: FULL_ADMINISTRATOR });
  passes(
    await ask("/admin", { cookie: `${SESSION}; forum_locale=es` }),
    "http://localhost/es/admin",
  );
});

test("the API, the icon and the upload routes stay at their public addresses", async () => {
  reset();
  assert.equal(
    await ask("/api/v1/me", { headers: { "accept-language": "es" } }),
    undefined,
  );
  const icon = await ask("/favicon.ico", {
    headers: { "accept-language": "es" },
  });
  assert.equal(icon?.headers.get("x-middleware-next"), "1");
  assert.equal(rewriteOf(icon), null);
  // The upload routes are left out of the proxy by its matcher.
  const matcher = new RegExp(`^${config.matcher[0]}$`);
  for (const path of [
    "/threads/12/uploads",
    "/attachments",
    "/account/picture",
    "/admin/uploads",
  ])
    assert.equal(matcher.test(path), false, path);
  for (const path of ["/threads/12", "/account", "/admin", "/es/attachments"])
    assert.equal(matcher.test(path), true, path);
});

test("Next's own picture addresses are not rewritten into a language", async () => {
  reset();
  for (const path of [
    "/_next/image?url=%2Fx.png&w=64&q=75",
    "/_next/static/media/logo.png",
    "/_next/static/media/font.woff2",
    "/_next/static/chunks/app.js",
  ]) {
    const response = await ask(path, { headers: { "accept-language": "es" } });
    assert.equal(rewriteOf(response) ?? null, null, path);
    assert.equal(response?.headers.get("location") ?? null, null, path);
  }
});

test("a picture-looking address that is no page gets the 404 of the language", async () => {
  reset();
  const response = await ask("/pictures/tobi.jpg", {
    headers: { "accept-language": "es" },
  });
  assert.equal(rewriteOf(response), "http://localhost/es/pictures/tobi.jpg");
});

test("the site's default language comes after the cookie and the browser, and is asked for only then", async () => {
  reset({ siteDefault: "es" });
  assert.equal(
    rewriteOf(await ask("/forums", { cookie: "forum_locale=en" })),
    "http://localhost/en/forums",
  );
  assert.equal(
    rewriteOf(await ask("/forums", { headers: { "accept-language": "en" } })),
    "http://localhost/en/forums",
  );
  assert.equal(state.defaultAsked, 0);
  assert.equal(
    rewriteOf(await ask("/forums", { headers: { "accept-language": "fr" } })),
    "http://localhost/es/forums",
  );
  assert.equal(rewriteOf(await ask("/forums")), "http://localhost/es/forums");
  assert.equal(state.defaultAsked, 2);
  reset({ siteDefault: "en" });
  assert.equal(rewriteOf(await ask("/forums")), "http://localhost/en/forums");
});
