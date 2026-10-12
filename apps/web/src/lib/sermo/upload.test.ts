import { afterEach, mock, test } from "bun:test";
import assert from "node:assert/strict";
import { SermoError } from "./errors";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

let incoming = new Headers();
mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  headers: async () => incoming,
  cookies: async () => ({ set: () => {} }),
}));

const { upload, uploadWith } = await import("./upload");

function backend(...answers: Response[]) {
  const seen: { url: string; init: RequestInit }[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    seen.push({ url, init });
    return answers[Math.min(seen.length - 1, answers.length - 1)];
  }) as unknown as typeof fetch;
  return seen;
}

const picture = () => new File([new Uint8Array([1, 2, 3])], "me.png");

test("a file goes as one multipart part with the visitor's identity and no content type", async () => {
  const seen = backend(
    Response.json({ id: 41, url: "/api/v1/files/41" }, { status: 201 }),
  );
  const id = await uploadWith(
    {
      cookie: "theme=dark; sermo.session_token=abc",
      userAgent: "agent/1",
      clientIp: "198.51.100.4",
    },
    "avatar",
    picture(),
    "me.png",
  );
  assert.equal(id, 41);
  assert.equal(
    seen[0].url,
    "http://127.0.0.1:8787/api/v1/files?purpose=avatar",
  );
  assert.equal(seen[0].init.method, "POST");
  const headers = new Headers(seen[0].init.headers);
  assert.equal(headers.get("content-type"), null);
  assert.equal(headers.get("origin"), "http://localhost:3000");
  assert.equal(headers.get("cookie"), "sermo.session_token=abc");
  assert.equal(headers.get("user-agent"), "agent/1");
  assert.equal(headers.get("x-forwarded-for"), "198.51.100.4");
  const body = seen[0].init.body as FormData;
  assert.ok(body instanceof FormData);
  assert.deepEqual([...body.keys()], ["file"]);
  assert.equal((body.get("file") as File).name, "me.png");
});

test("the visitor's request settles the forwarding", async () => {
  incoming = new Headers({ cookie: "sermo.session_token=dead" });
  const seen = backend(
    Response.json({
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
      staff: { panel: false, moderatesEverywhere: false, moderatedNodeIds: [] },
    }),
  );
  // auth.me is asked first and its answer is no file id, so the upload fails after it.
  await assert.rejects(upload("cover", picture()));
  assert.equal(seen.length, 2);
  assert.equal(seen[1].url, "http://127.0.0.1:8787/api/v1/files?purpose=cover");
});

test("the backend's refusal becomes a SermoError with its message", async () => {
  backend(
    Response.json(
      { error: { code: "validation", message: "Not a picture." } },
      { status: 400 },
    ),
  );
  await assert.rejects(
    uploadWith({}, "avatar", picture(), "me.png"),
    (error) =>
      error instanceof SermoError &&
      error.code === "validation" &&
      error.status === 400 &&
      error.message === "Not a picture.",
  );
});

test("an answer that is not JSON is an internal error", async () => {
  backend(new Response("<html>", { status: 502 }));
  await assert.rejects(
    uploadWith({}, "avatar", picture(), "me.png"),
    (error) => error instanceof SermoError && error.code === "internal",
  );
});

test("an unreachable API is an internal error", async () => {
  globalThis.fetch = (async () => {
    throw new TypeError("fetch failed");
  }) as unknown as typeof fetch;
  await assert.rejects(
    uploadWith({}, "avatar", picture(), "me.png"),
    (error) =>
      error instanceof SermoError &&
      error.code === "internal" &&
      error.message.includes("could not be reached"),
  );
});
