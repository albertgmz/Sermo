import { afterEach, expect, mock, test } from "bun:test";
import { postBody } from "@/lib/test-bodies";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  revalidated.length = 0;
  cookieSets.length = 0;
  refreshed = 0;
});

let incoming = new Headers();
const cookieSets: unknown[][] = [];
const revalidated: unknown[][] = [];
let refreshed = 0;
mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  headers: async () => incoming,
  cookies: async () => ({
    set: (...args: unknown[]) => cookieSets.push(args),
    get: () => undefined,
    delete: () => {},
    toString: () => "",
  }),
}));
const nextCache = await import("next/cache");
mock.module("next/cache", () => ({
  ...nextCache,
  revalidatePath: (...args: unknown[]) => revalidated.push(args),
  refresh: () => {
    refreshed += 1;
  },
}));

const source = "./actions.ts?reactions";
const {
  followFromPage,
  blockFromPage,
  react,
  replyFromFeed,
  setBookmark,
  setLiteMode,
  setLocaleCookie,
} = (await import(source)) as typeof import("./actions");

const SUMMARY = { counts: {}, total: 0, mine: null };

const replyForm = (body: string) => {
  const data = new FormData();
  data.set("body", body);
  return data;
};

// Where the action redirected to, or nothing when it answered the form instead.
const redirectOf = (run: Promise<unknown>) =>
  run.then(
    () => undefined,
    (error: { digest?: unknown }) => String(error.digest).split(";"),
  );

const refusal = (status: number, code: string, message = code) =>
  Response.json({ error: { code, message } }, { status });

function backend(response: Response) {
  const asked: {
    method: string;
    path: string;
    search: string;
    body: unknown;
  }[] = [];
  globalThis.fetch = (async (input: string, init: RequestInit) => {
    asked.push({
      method: init.method ?? "GET",
      path: new URL(input).pathname,
      search: new URL(input).search,
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    });
    return response.clone();
  }) as unknown as typeof fetch;
  return asked;
}

// The request's own host is the referer's unless the test says otherwise.
function onPage(referer?: string, host = referer && new URL(referer).host) {
  incoming = new Headers(referer && host ? { referer, host } : {});
}

test("a reaction is one write and draws nothing again", async () => {
  onPage("http://localhost:3105/threads/5?page=2");
  const asked = backend(Response.json(SUMMARY));
  expect(await react("post", 9, 2)).toEqual({});
  expect(refreshed).toBe(0);
  expect(revalidated).toEqual([]);
  expect(asked).toHaveLength(1);
  expect(asked[0].path).toBe("/api/v1/reactions/post/9");
  expect(asked[0].body).toEqual({ reactionTypeId: 2 });
});

// Every page that draws the reactions element: the feed and its views, a thread, a profile and
// its tabs, a conversation.
test("a reaction refreshes no page, wherever it was made", async () => {
  for (const referer of [
    "http://localhost:3105/",
    "http://localhost:3105/?tab=top&cursor=abc",
    "http://localhost:3105/threads/5?page=2",
    "http://localhost:3105/members/7?tab=wall",
    "http://localhost:3105/conversations/3",
  ]) {
    refreshed = 0;
    onPage(referer);
    backend(Response.json(SUMMARY));
    expect(await react("post", 9, 2)).toEqual({});
    expect(refreshed, referer).toBe(0);
  }
});

test("a message, a wall post and a wall comment are reacted to under their backend names", async () => {
  onPage("http://localhost:3105/conversations/3");
  for (const [target, contentType] of [
    ["message", "conversation_message"],
    ["profilePost", "profile_post"],
    ["profileComment", "profile_post_comment"],
  ] as const) {
    const asked = backend(Response.json(SUMMARY));
    await react(target, 4, null);
    expect(asked[0].method).toBe("DELETE");
    expect(asked[0].path).toBe(`/api/v1/reactions/${contentType}/4`);
  }
});

test("the backend's refusal goes back to the button and refreshes nothing", async () => {
  onPage("http://localhost:3105/threads/5");
  backend(refusal(403, "forbidden", "You cannot react to your own post."));
  expect(await react("post", 9, 2)).toEqual({
    error: "You cannot react to your own post.",
  });
  expect(refreshed).toBe(0);
  expect(revalidated).toEqual([]);
});

// The button has shown the change already: a redirect would leave it standing, so the answer says
// where to sign in and the button puts the change back and goes there.
test("a visitor who must sign in is told where, and is not redirected", async () => {
  onPage("http://localhost:3105/threads/5?page=2");
  backend(refusal(401, "unauthenticated"));
  expect(await react("post", 9, 2)).toEqual({
    error: "unauthenticated",
    signIn: "/login?next=%2Fthreads%2F5%3Fpage%3D2",
  });
  expect(refreshed).toBe(0);
  expect(revalidated).toEqual([]);
});

test("a target the page cannot have sent is ignored without asking the backend", async () => {
  onPage();
  const asked = backend(Response.json(SUMMARY));
  expect(await react("thread" as never, 9, 2)).toEqual({});
  expect(asked).toHaveLength(0);
  expect(refreshed).toBe(0);
});

test("no path is revalidated, whatever the referer says", async () => {
  for (const [referer, host] of [
    ["https://evil.example/threads/5", "forum.example"],
    ["http://localhost:3105/account/security", "localhost:3105"],
    ["http://localhost:3105/threads", "localhost:3105"],
  ]) {
    onPage(referer, host);
    backend(Response.json(SUMMARY));
    expect(await react("post", 9, 2)).toEqual({});
  }
  expect(revalidated).toEqual([]);
});

test("an id that cannot be a record is refused before the backend is asked", async () => {
  onPage("http://localhost:3105/threads/5");
  const asked = backend(Response.json(SUMMARY));
  for (const id of [0, -1, 1.5, Number.NaN, ".."] as unknown as number[]) {
    await expect(react("post", id, 2)).rejects.toThrow();
  }
  await expect(react("post", 9, 0)).rejects.toThrow();
  expect(asked).toHaveLength(0);
});

// Where setLiteMode sends the visitor, from the digest of the redirect it throws.
async function liteGoesTo(returnTo: string) {
  const data = new FormData();
  data.set("mode", "off");
  data.set("returnTo", returnTo);
  try {
    await setLiteMode(data);
  } catch (error) {
    const digest = (error as { digest?: string }).digest ?? "";
    return digest.split(";")[2];
  }
  throw new Error("expected a redirect");
}

test("the viewing mode goes back to a path of this site and to nowhere else", async () => {
  expect(await liteGoesTo("/data-saver?saved=1")).toBe("/data-saver?saved=1");
  expect(await liteGoesTo("/forums/3-general#top")).toBe(
    "/forums/3-general#top",
  );
  for (const bad of [
    "//evil.example",
    "/.//evil.example",
    "/a/../..//evil.example",
    "/a\b",
    "https://evil.example",
    "evil",
    "/login",
    "/_next/image?url=x",
  ]) {
    expect(await liteGoesTo(bad), bad).toBe("/");
  }
});

test("a reply from a feed card is one write and returns to the feed address it was written on, pages included", async () => {
  for (const page of [
    "/",
    "/?tab=following",
    "/?tab=top&cursor=abc",
    "/?pages=4",
    "/?tab=top&cursor=abc&pages=3",
  ]) {
    refreshed = 0;
    onPage(`http://localhost:3105${page}`);
    const asked = backend(Response.json(postBody({ threadId: 7 })));
    const parts = await redirectOf(replyFromFeed(7, {}, replyForm("hello")));
    expect(parts?.[0]).toBe("NEXT_REDIRECT");
    expect(parts?.[2]).toBe(page);
    expect(asked).toHaveLength(1);
    expect(asked[0].method).toBe("POST");
    expect(asked[0].path).toBe("/api/v1/threads/7/posts");
    expect(asked[0].body).toEqual({ body: "hello" });
    // The address can differ from the browser's by its hash alone, so the page is drawn again.
    expect(refreshed).toBe(1);
  }
});

test("a refused reply from a feed card answers its form with the backend's message and goes nowhere", async () => {
  onPage("http://localhost:3105/?tab=top");
  backend(refusal(403, "forbidden", "This thread is locked."));
  expect(await replyFromFeed(7, {}, replyForm("hello"))).toEqual({
    error: "This thread is locked.",
  });
  expect(refreshed).toBe(0);
});

test("a reply refused for the permission, or for posting too fast, answers the form with the backend's message", async () => {
  for (const [status, code, message] of [
    [403, "forbidden", "You may not reply in this forum."],
    [429, "rate_limited", "Wait 20 seconds before posting again."],
    [403, "forbidden", "You are banned from this thread."],
  ] as const) {
    refreshed = 0;
    onPage("http://localhost:3105/?tab=top");
    const asked = backend(refusal(status, code, message));
    expect(await replyFromFeed(7, {}, replyForm("hello"))).toEqual({
      error: message,
    });
    // One write, no redirect, and the page is not drawn again: what was typed stays.
    expect(asked).toHaveLength(1);
    expect(refreshed).toBe(0);
  }
});

test("a reply from a feed card does not follow an address that is not on this site", async () => {
  for (const [referer, host] of [
    ["https://elsewhere.example/?pages=2", "localhost:3105"],
    // On this site, but a path that a browser would follow to another host.
    ["http://localhost:3105//evil.example/x?pages=2", "localhost:3105"],
    ["http://localhost:3105/\\evil.example", "localhost:3105"],
    ["http://localhost:3105/.//evil.example", "localhost:3105"],
    [undefined, undefined],
  ] as const) {
    onPage(referer, host);
    backend(Response.json(postBody({ threadId: 7 })));
    const parts = await redirectOf(replyFromFeed(7, {}, replyForm("hello")));
    expect(parts?.[0]).toBe("NEXT_REDIRECT");
    expect(parts?.[2]).toBe("/");
  }
});

test("a guest who replies from a feed card is sent to sign in and back to the feed as they had it", async () => {
  onPage("http://localhost:3105/?tab=top&pages=3");
  backend(refusal(401, "unauthenticated"));
  const parts = await redirectOf(replyFromFeed(7, {}, replyForm("hello")));
  expect(parts?.[2]).toBe("/login?next=%2F%3Ftab%3Dtop%26pages%3D3");
  expect(refreshed).toBe(0);
});

test("a thread id that is not a record id never reaches the backend", async () => {
  const asked = backend(Response.json(postBody()));
  await expect(
    replyFromFeed(Number.NaN, {}, replyForm("hello")),
  ).rejects.toThrow();
  expect(asked).toHaveLength(0);
});

test("following from a page is one write that refreshes nothing and does not redirect", async () => {
  onPage("http://localhost:3105/threads/5?page=2");
  const asked = backend(Response.json({ following: true, followerCount: 3 }));
  expect(await followFromPage(8, true)).toEqual({});
  expect(refreshed).toBe(0);
  expect(revalidated).toEqual([]);
  expect(asked).toHaveLength(1);
  expect(asked[0].method).toBe("PUT");
  expect(asked[0].path).toBe("/api/v1/users/8/follow");
});

test("unfollowing from a page asks to stop and refreshes nothing", async () => {
  onPage("http://localhost:3105/conversations/3");
  const asked = backend(Response.json({ ok: true }));
  expect(await followFromPage(8, false)).toEqual({});
  expect(refreshed).toBe(0);
  expect(asked[0].method).toBe("DELETE");
  expect(asked[0].path).toBe("/api/v1/users/8/follow");
});

test("blocking and unblocking from a page use users.block and refresh nothing", async () => {
  onPage("http://localhost:3105/threads/5");
  let asked = backend(Response.json({ ok: true }));
  expect(await blockFromPage(8, true)).toEqual({});
  expect(asked.map((call) => [call.method, call.path])).toEqual([
    ["PUT", "/api/v1/users/8/block"],
  ]);
  asked = backend(Response.json({ ok: true }));
  expect(await blockFromPage(8, false)).toEqual({});
  expect(asked.map((call) => [call.method, call.path])).toEqual([
    ["DELETE", "/api/v1/users/8/block"],
  ]);
  expect(refreshed).toBe(0);
  expect(revalidated).toEqual([]);
  backend(refusal(403, "forbidden", "You may not block that member."));
  expect(await blockFromPage(8, true)).toEqual({
    error: "You may not block that member.",
  });
});

test("the backend's refusal of a follow goes back to the button and refreshes nothing", async () => {
  onPage("http://localhost:3105/threads/5");
  backend(refusal(403, "forbidden", "You may not follow members."));
  expect(await followFromPage(8, true)).toEqual({
    error: "You may not follow members.",
  });
  expect(refreshed).toBe(0);
});

test("a visitor who follows and must sign in is told where, and is not redirected", async () => {
  onPage("http://localhost:3105/threads/5?page=2");
  backend(refusal(401, "unauthenticated"));
  const answer = await followFromPage(8, true);
  expect(answer.signIn).toBe("/login?next=%2Fthreads%2F5%3Fpage%3D2");
  expect(await redirectOf(followFromPage(8, true))).toBeUndefined();
  expect(refreshed).toBe(0);
});

test("a visitor who bookmarks and must sign in is told where, and is not redirected", async () => {
  onPage("http://localhost:3105/threads/5");
  backend(refusal(401, "unauthenticated"));
  const answer = await setBookmark("post", 12, true);
  expect(answer.signIn).toBe("/login?next=%2Fthreads%2F5");
  expect(await redirectOf(setBookmark("post", 12, true))).toBeUndefined();
});

test("a member id that cannot be a record is refused before the backend is asked", async () => {
  onPage("http://localhost:3105/threads/5");
  const asked = backend(Response.json({ ok: true }));
  await expect(followFromPage(0, true)).rejects.toThrow();
  expect(asked).toHaveLength(0);
});

test("bookmarking from a page is one PUT that refreshes nothing and does not redirect", async () => {
  onPage("http://localhost:3105/threads/5");
  const asked = backend(Response.json({ ok: true }));
  expect(await setBookmark("post", 12, true)).toEqual({});
  expect(refreshed).toBe(0);
  expect(asked).toHaveLength(1);
  expect(asked[0].method).toBe("PUT");
  expect(asked[0].path).toBe("/api/v1/bookmarks");
  expect(asked[0].body).toEqual({
    contentType: "post",
    contentId: 12,
    bookmarked: true,
  });
});

test("a refused bookmark goes back to the button and a forged type is not sent", async () => {
  onPage("http://localhost:3105/threads/5");
  const asked = backend(refusal(404, "not_found", "Not found."));
  expect(await setBookmark("thread", 5, true)).toEqual({ error: "Not found." });
  expect(refreshed).toBe(0);
  asked.length = 0;
  expect(await setBookmark("profile" as never, 5, true)).toEqual({});
  await expect(setBookmark("thread", 0, true)).rejects.toThrow();
  expect(asked).toHaveLength(0);
});

test("the language cookie is written for a supported language only", async () => {
  await setLocaleCookie("es");
  await setLocaleCookie("fr");
  await setLocaleCookie("");
  expect(cookieSets).toHaveLength(1);
  expect(cookieSets[0]?.slice(0, 2)).toEqual(["forum_locale", "es"]);
  expect(cookieSets[0]?.[2]).toMatchObject({ path: "/", httpOnly: false });
});

// Runs `body` with the site served at `url`, as SERMO_PUBLIC_URL says.
async function servedAt(url: string, body: () => Promise<void>) {
  const before = process.env.SERMO_PUBLIC_URL;
  process.env.SERMO_PUBLIC_URL = url;
  try {
    await body();
  } finally {
    if (before === undefined) delete process.env.SERMO_PUBLIC_URL;
    else process.env.SERMO_PUBLIC_URL = before;
  }
}

test("the language and Data saver cookies are Secure on an https site, Lax and readable by the page's scripts", async () => {
  const lite = new FormData();
  lite.set("mode", "all");
  lite.set("returnTo", "/");
  for (const [url, secure] of [
    ["https://forum.example.test", true],
    ["http://localhost:3000", false],
  ] as const) {
    cookieSets.length = 0;
    await servedAt(url, async () => {
      await setLocaleCookie("es");
      await redirectOf(setLiteMode(lite));
    });
    expect(cookieSets.map((set) => set[0])).toEqual([
      "forum_locale",
      "forum_lite",
    ]);
    for (const set of cookieSets)
      expect(set[2], `${url} ${set[0]}`).toMatchObject({
        path: "/",
        sameSite: "lax",
        httpOnly: false,
        secure,
      });
  }
});
