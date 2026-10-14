import { afterEach, expect, mock, test } from "bun:test";
import { postBody } from "@/lib/test-bodies";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  revalidated.length = 0;
  refreshed = 0;
});

let incoming = new Headers();
const revalidated: unknown[][] = [];
let refreshed = 0;
mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  headers: async () => incoming,
  cookies: async () => ({
    set: () => {},
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
const { followFromPage, react, replyFromFeed, setLiteMode } = (await import(
  source
)) as typeof import("./actions");

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

test("a reaction is one write, refreshes the page once and revalidates no path", async () => {
  onPage("http://localhost:3105/threads/5?page=2");
  const asked = backend(Response.json(SUMMARY));
  expect(await react("post", 9, 2)).toEqual({});
  expect(refreshed).toBe(1);
  expect(revalidated).toEqual([]);
  expect(asked).toHaveLength(1);
  expect(asked[0].path).toBe("/api/v1/reactions/post/9");
  expect(asked[0].body).toEqual({ reactionTypeId: 2 });
});

// Every page that draws the reactions element: the feed and its views, a thread, a profile and
// its tabs, a conversation.
test("a reaction shows the page it was made on again, wherever that is", async () => {
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
    expect(refreshed, referer).toBe(1);
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

test("a guest is sent to sign in and back to the page they were on", async () => {
  onPage("http://localhost:3105/threads/5?page=2");
  backend(refusal(401, "unauthenticated"));
  let digest = "";
  try {
    await react("post", 9, 2);
  } catch (error) {
    digest = String((error as { digest?: unknown }).digest);
  }
  expect(digest).toMatch(
    /^NEXT_REDIRECT;[a-z]+;\/login\?next=%2Fthreads%2F5%3Fpage%3D2;/,
  );
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
  expect(await liteGoesTo("/lite?saved=1")).toBe("/lite?saved=1");
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

test("a reply from a feed card is one write and returns to the feed address it was written on", async () => {
  for (const page of ["/", "/?tab=following", "/?tab=top&cursor=abc"]) {
    refreshed = 0;
    const asked = backend(Response.json(postBody({ threadId: 7 })));
    const parts = await redirectOf(
      replyFromFeed(7, page, {}, replyForm("hello")),
    );
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
  backend(refusal(403, "forbidden", "This thread is locked."));
  expect(await replyFromFeed(7, "/?tab=top", {}, replyForm("hello"))).toEqual({
    error: "This thread is locked.",
  });
  expect(refreshed).toBe(0);
});

test("a reply from a feed card does not follow a return path that leaves the site", async () => {
  for (const page of ["https://elsewhere.example/", "//elsewhere.example"]) {
    backend(Response.json(postBody({ threadId: 7 })));
    const parts = await redirectOf(
      replyFromFeed(7, page, {}, replyForm("hello")),
    );
    expect(parts?.[0]).toBe("NEXT_REDIRECT");
    expect(parts?.[2]).toBe("/");
  }
});

test("a guest who replies from a feed card is sent to sign in and back to the feed", async () => {
  backend(refusal(401, "unauthenticated"));
  const parts = await redirectOf(
    replyFromFeed(7, "/?tab=top", {}, replyForm("hello")),
  );
  expect(parts?.[2]).toBe("/login?next=%2F%3Ftab%3Dtop");
  expect(refreshed).toBe(0);
});

test("a thread id that is not a record id never reaches the backend", async () => {
  const asked = backend(Response.json(postBody()));
  await expect(
    replyFromFeed(Number.NaN, "/", {}, replyForm("hello")),
  ).rejects.toThrow();
  expect(asked).toHaveLength(0);
});

test("following from a page is one write that refreshes the page and does not redirect", async () => {
  onPage("http://localhost:3105/threads/5?page=2");
  const asked = backend(Response.json({ following: true, followerCount: 3 }));
  expect(await followFromPage(8, true)).toEqual({});
  expect(refreshed).toBe(1);
  expect(revalidated).toEqual([]);
  expect(asked).toHaveLength(1);
  expect(asked[0].method).toBe("PUT");
  expect(asked[0].path).toBe("/api/v1/users/8/follow");
});

test("unfollowing from a page asks to stop and refreshes once", async () => {
  onPage("http://localhost:3105/conversations/3");
  const asked = backend(Response.json({ ok: true }));
  expect(await followFromPage(8, false)).toEqual({});
  expect(refreshed).toBe(1);
  expect(asked[0].method).toBe("DELETE");
  expect(asked[0].path).toBe("/api/v1/users/8/follow");
});

test("the backend's refusal of a follow goes back to the button and refreshes nothing", async () => {
  onPage("http://localhost:3105/threads/5");
  backend(refusal(403, "forbidden", "You may not follow members."));
  expect(await followFromPage(8, true)).toEqual({
    error: "You may not follow members.",
  });
  expect(refreshed).toBe(0);
});

test("a guest who follows is sent to sign in and back to the page", async () => {
  onPage("http://localhost:3105/threads/5?page=2");
  backend(refusal(401, "unauthenticated"));
  expect((await redirectOf(followFromPage(8, true)))?.[2]).toBe(
    "/login?next=%2Fthreads%2F5%3Fpage%3D2",
  );
  expect(refreshed).toBe(0);
});

test("a member id that cannot be a record is refused before the backend is asked", async () => {
  onPage("http://localhost:3105/threads/5");
  const asked = backend(Response.json({ ok: true }));
  await expect(followFromPage(0, true)).rejects.toThrow();
  expect(asked).toHaveLength(0);
});
