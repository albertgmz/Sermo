import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { NextRequest } from "next/server";
import { messages } from "@/i18n/messages";
import { siteAnswer } from "@/lib/test-bodies";
import { translator } from "@/lib/test-intl";

const realFetch = globalThis.fetch;

mock.module("server-only", () => ({}));
const intl = await import("next-intl/server");
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async (namespace: string) => translator(namespace, true),
}));
const nextCache = await import("next/cache");
mock.module("next/cache", () => ({
  ...nextCache,
  revalidatePath: () => {},
  cacheLife: () => {},
  cacheTag: () => {},
}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ set: () => {} }),
}));

const { POST } = await import("./route");

afterAll(() => {
  mock.module("next-intl/server", () => intl);
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const BOUNDARY = "multipart/form-data; boundary=----x1";

// A body that records whether anyone started reading it.
function posted(
  headers: Record<string, string>,
  query = "kind=avatar",
  bytes = 5,
) {
  const state = { pulled: false };
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        state.pulled = true;
        controller.enqueue(new Uint8Array(bytes));
        controller.close();
      },
    },
    { highWaterMark: 0 },
  );
  const request = new NextRequest(
    `http://localhost:3000/account/picture?${query}`,
    {
      method: "POST",
      headers: {
        "content-type": BOUNDARY,
        origin: "http://localhost:3000",
        host: "localhost:3000",
        "content-length": String(bytes),
        ...headers,
      },
      body,
      duplex: "half",
    } as never,
  );
  return { request, state };
}

function backend(...answers: Response[]) {
  const asked: { url: string; method: string; body: unknown }[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    const site = siteAnswer(url);
    if (site) return site;
    let body: unknown = init.body ?? null;
    if (body instanceof ReadableStream) {
      let length = 0;
      const reader = body.getReader();
      for (
        let part = await reader.read();
        !part.done;
        part = await reader.read()
      )
        length += part.value.length;
      body = length;
    } else if (typeof body === "string") {
      body = JSON.parse(body);
    }
    asked.push({ url, method: String(init.method), body });
    return answers[Math.min(asked.length - 1, answers.length - 1)];
  }) as unknown as typeof fetch;
  return asked;
}

const member = { cookie: "sermo.session_token=abc" };

const answer = async (response: Response) => ({
  status: response.status,
  body: await response.json().catch(() => null),
});

test("a visitor without a session cookie is told 401 and nothing is read or sent", async () => {
  const asked = backend(Response.json({}));
  const { request, state } = posted({});
  expect(await answer(await POST(request))).toEqual({
    status: 401,
    body: { error: "" },
  });
  expect(state.pulled).toBe(false);
  expect(asked).toEqual([]);
});

test("a post from another site is refused before anything is read", async () => {
  const asked = backend(Response.json({}));
  const { request, state } = posted({
    ...member,
    origin: "https://elsewhere.example",
  });
  expect((await POST(request)).status).toBe(403);
  expect(state.pulled).toBe(false);
  expect(asked).toEqual([]);
});

test("a body that is no multipart form, or declares no length or too much, is refused before it is read", async () => {
  const asked = backend(Response.json({}));
  for (const headers of [
    { "content-type": "text/plain" } as Record<string, string>,
    { "content-length": "" },
    { "content-length": "99999999999" },
  ]) {
    const { request, state } = posted({ ...member, ...headers });
    const response = await POST(request);
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(typeof (await response.json()).error).toBe("string");
    expect(state.pulled).toBe(false);
  }
  expect(asked).toEqual([]);
});

test("a purpose that is not a picture of the member is refused", async () => {
  const asked = backend(Response.json({}));
  for (const query of ["kind=attachment", "kind=", ""]) {
    const { request, state } = posted(member, query);
    expect((await POST(request)).status).toBe(400);
    expect(state.pulled).toBe(false);
  }
  expect(asked).toEqual([]);
});

test("a picture is streamed on and attached", async () => {
  const asked = backend(
    Response.json({ id: 9 }, { status: 201 }),
    Response.json({ fileId: 9, url: "/api/v1/files/9" }),
  );
  const { request } = posted(member, "kind=cover", 12);
  expect(await answer(await POST(request))).toEqual({
    status: 200,
    body: { ok: true },
  });
  expect(asked[0]).toEqual({
    url: "http://127.0.0.1:8787/api/v1/files?purpose=cover",
    method: "POST",
    body: 12,
  });
  expect(asked[1].url).toBe("http://127.0.0.1:8787/api/v1/profile/cover");
  expect(asked[1].body).toEqual({ fileId: 9 });
});

test("a picture the backend refuses comes back with the backend's message and status", async () => {
  backend(
    Response.json(
      { error: { code: "validation", message: "File exceeds upload limit." } },
      { status: 400 },
    ),
  );
  expect(await answer(await POST(posted(member).request))).toEqual({
    status: 400,
    body: { error: "File exceeds upload limit." },
  });
});

test("a session the backend no longer accepts is told 401", async () => {
  backend(
    Response.json(
      { error: { code: "unauthenticated", message: "Sign in." } },
      { status: 401 },
    ),
  );
  expect((await POST(posted(member).request)).status).toBe(401);
});

test("a picture above the site's limit is a 413 with the limit in the message and is not sent", async () => {
  const asked = backend(Response.json({}));
  const { request, state } = posted({
    ...member,
    "content-length": String(7 * 1024 * 1024),
  });
  expect(await answer(await POST(request))).toEqual({
    status: 413,
    body: {
      error: messages.account.pictures.overLimit.replace("{size}", "5"),
    },
  });
  expect(state.pulled).toBe(false);
  expect(asked).toEqual([]);
});
