import { afterEach, expect, mock, test } from "bun:test";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  revalidated.length = 0;
});

let incoming = new Headers();
const revalidated: unknown[][] = [];
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
}));

const source = "./actions.ts?reactions";
const { react, setLiteMode } = (await import(
  source
)) as typeof import("./actions");

const SUMMARY = { counts: {}, total: 0, mine: null };

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

test("a reaction revalidates the page it was made on and nothing else", async () => {
  onPage("http://localhost:3105/threads/5?page=2");
  const asked = backend(Response.json(SUMMARY));
  expect(await react("post", 9, 2)).toEqual({});
  expect(revalidated).toEqual([["/threads/5"]]);
  expect(asked).toHaveLength(1);
  expect(asked[0].path).toBe("/api/v1/reactions/post/9");
  expect(asked[0].body).toEqual({ reactionTypeId: 2 });
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

test("the backend's refusal goes back to the button and revalidates nothing", async () => {
  onPage("http://localhost:3105/threads/5");
  backend(refusal(403, "forbidden", "You cannot react to your own post."));
  expect(await react("post", 9, 2)).toEqual({
    error: "You cannot react to your own post.",
  });
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
  expect(revalidated).toEqual([]);
});

test("a target the page cannot have sent is ignored without asking the backend", async () => {
  onPage();
  const asked = backend(Response.json(SUMMARY));
  expect(await react("thread" as never, 9, 2)).toEqual({});
  expect(asked).toHaveLength(0);
});

test("a referer from another host revalidates nothing", async () => {
  onPage("https://evil.example/threads/5", "forum.example");
  backend(Response.json(SUMMARY));
  expect(await react("post", 9, 2)).toEqual({});
  expect(revalidated).toEqual([]);
});

test("a page that is not one where reactions are made is not revalidated", async () => {
  for (const referer of [
    "http://localhost:3105/account/security",
    "http://localhost:3105/",
    "http://localhost:3105/threads",
  ]) {
    onPage(referer);
    backend(Response.json(SUMMARY));
    await react("post", 9, 2);
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
