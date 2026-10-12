import { afterEach, mock, test } from "bun:test";
import assert from "node:assert/strict";
import { SermoError } from "./errors";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

mock.module("server-only", () => ({}));

const {
  BACKEND_PURPOSES,
  DECLARED_LENGTH_CEILING,
  MEMBER_PURPOSES,
  PANEL_PURPOSES,
  isPicturePurpose,
  isUploadPurpose,
  receiveUpload,
  uploadWith,
} = await import("./upload");

function backend(...answers: Response[]) {
  const seen: { url: string; init: RequestInit }[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    seen.push({ url, init });
    return answers[Math.min(seen.length - 1, answers.length - 1)];
  }) as unknown as typeof fetch;
  return seen;
}

const BOUNDARY = "multipart/form-data; boundary=----x1";

function picture() {
  return {
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
        controller.close();
      },
    }),
  };
}

const source = () => ({ body: picture().body, contentType: BOUNDARY });

test("the body goes on as a stream with the visitor's identity and their own content type", async () => {
  const seen = backend(
    Response.json({ id: 41, url: "/api/v1/files/41" }, { status: 201 }),
  );
  const { body } = picture();
  const id = await uploadWith(
    {
      cookie: "theme=dark; sermo.session_token=abc",
      userAgent: "agent/1",
      clientIp: "198.51.100.4",
    },
    "avatar",
    { body, contentType: BOUNDARY },
  );
  assert.equal(id, 41);
  assert.equal(
    seen[0].url,
    "http://127.0.0.1:8787/api/v1/files?purpose=avatar",
  );
  assert.equal(seen[0].init.method, "POST");
  assert.equal(seen[0].init.body, body);
  assert.equal((seen[0].init as { duplex?: string }).duplex, "half");
  // Nobody here took a reader on it: the stream is the backend's to consume.
  assert.equal(body.locked, false);
  const headers = new Headers(seen[0].init.headers);
  assert.equal(headers.get("content-type"), BOUNDARY);
  assert.equal(headers.get("origin"), "http://localhost:3000");
  assert.equal(headers.get("cookie"), "sermo.session_token=abc");
  assert.equal(headers.get("user-agent"), "agent/1");
  assert.equal(headers.get("x-forwarded-for"), "198.51.100.4");
});

test("only the purposes this app uploads are sent", async () => {
  const seen = backend(Response.json({ id: 1 }, { status: 201 }));
  for (const purpose of ["nonsense", "", "Avatar"]) {
    await assert.rejects(
      uploadWith({}, purpose as "avatar", source()),
      (error) => error instanceof SermoError && error.code === "validation",
    );
  }
  assert.equal(seen.length, 0);
  assert.equal(isUploadPurpose("cover"), true);
  assert.equal(isUploadPurpose("attachment"), true);
  assert.equal(isUploadPurpose("frame"), true);
  assert.equal(isUploadPurpose("nonsense"), false);
  assert.equal(isPicturePurpose("cover"), true);
  assert.equal(isPicturePurpose("attachment"), false);
  assert.equal(isPicturePurpose("frame"), false);
});

test("every purpose of the backend is classified as a member's or the panel's, once", () => {
  const classified = [...MEMBER_PURPOSES, ...PANEL_PURPOSES];
  assert.equal(new Set(classified).size, classified.length);
  assert.deepEqual([...classified].sort(), [...BACKEND_PURPOSES].sort());
});

test("a request with no body or no content type is refused before the backend is asked", async () => {
  const seen = backend(Response.json({ id: 1 }, { status: 201 }));
  await assert.rejects(
    uploadWith({}, "avatar", { body: null, contentType: BOUNDARY }),
    (error) => error instanceof SermoError && error.code === "validation",
  );
  await assert.rejects(
    uploadWith({}, "avatar", { body: picture().body, contentType: null }),
    (error) => error instanceof SermoError && error.code === "validation",
  );
  assert.equal(seen.length, 0);
});

test("the backend's refusal becomes a SermoError with its message", async () => {
  backend(
    Response.json(
      { error: { code: "validation", message: "Not a picture." } },
      { status: 400 },
    ),
  );
  await assert.rejects(
    uploadWith({}, "avatar", source()),
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
    uploadWith({}, "avatar", source()),
    (error) => error instanceof SermoError && error.code === "internal",
  );
});

test("an answer without a file id is an internal error", async () => {
  backend(Response.json({ url: "/x" }, { status: 201 }));
  await assert.rejects(
    uploadWith({}, "avatar", source()),
    (error) => error instanceof SermoError && error.code === "internal",
  );
});

test("an unreachable API is an internal error", async () => {
  globalThis.fetch = (async () => {
    throw new TypeError("fetch failed");
  }) as unknown as typeof fetch;
  await assert.rejects(
    uploadWith({}, "avatar", source()),
    (error) =>
      error instanceof SermoError &&
      error.code === "internal" &&
      error.message.includes("could not be reached"),
  );
});

// What a browser posts: a multipart body whose length it declares.
function incoming(headers: Record<string, string | null> = {}) {
  const state = { pulled: false };
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        state.pulled = true;
        controller.enqueue(new Uint8Array(5));
        controller.close();
      },
    },
    { highWaterMark: 0 },
  );
  const all: Record<string, string | null> = {
    cookie: "sermo.session_token=abc",
    origin: "http://localhost:3000",
    "content-type": BOUNDARY,
    "content-length": "5",
    ...headers,
  };
  const set: Record<string, string> = {};
  for (const [name, value] of Object.entries(all)) {
    if (value !== null) set[name] = value;
  }
  const request = new Request("http://localhost:3000/anything", {
    method: "POST",
    headers: set,
    body,
    duplex: "half",
  } as RequestInit);
  return { request, state };
}

test("a request is refused before anything is read when it fails a check that needs no body", async () => {
  const seen = backend(Response.json({ id: 1 }, { status: 201 }));
  const cases: [string, Record<string, string | null>, string, number][] = [
    ["no cookie", { cookie: null }, "session", 401],
    ["a cookie that is no session's", { cookie: "theme=dark" }, "session", 401],
    ["no origin", { origin: null }, "origin", 403],
    ["another origin", { origin: "http://evil.test" }, "origin", 403],
    [
      "a body that is not multipart",
      { "content-type": "text/plain" },
      "type",
      400,
    ],
    ["no content type", { "content-type": null }, "type", 400],
    ["no declared length", { "content-length": null }, "length", 411],
    ["a length that is no number", { "content-length": "12e3" }, "length", 411],
    ["a zero length", { "content-length": "0" }, "length", 411],
    [
      "a length above the ceiling",
      { "content-length": String(DECLARED_LENGTH_CEILING + 1) },
      "size",
      413,
    ],
  ];
  for (const [name, headers, reason, status] of cases) {
    const { request, state } = incoming(headers);
    const received = await receiveUpload(request, "attachment");
    assert.deepEqual(
      received.ok ? null : [received.reason, received.status],
      [reason, status],
      name,
    );
    assert.equal(state.pulled, false, `${name}: nothing was read`);
  }
  assert.equal(seen.length, 0);
});

test("the body handed to the backend is the request's own stream, never a copy", async () => {
  const seen = backend(Response.json({ id: 7 }, { status: 201 }));
  const { request, state } = incoming({
    "content-length": String(DECLARED_LENGTH_CEILING),
  });
  const received = await receiveUpload(request, "attachment");
  assert.deepEqual(received, { ok: true, fileId: 7 });
  assert.equal(
    seen[0].url,
    "http://127.0.0.1:8787/api/v1/files?purpose=attachment",
  );
  assert.ok(seen[0].init.body instanceof ReadableStream);
  assert.equal(seen[0].init.body, request.body);
  assert.equal((seen[0].init as { duplex?: string }).duplex, "half");
  // The fake backend never read it, and neither did the helper.
  assert.equal(state.pulled, false);
});

test("the backend's refusal keeps its status and words, a dead session is a session, an outage a failure", async () => {
  backend(
    Response.json(
      { error: { code: "forbidden", message: "Not for you." } },
      { status: 403 },
    ),
  );
  assert.deepEqual(await receiveUpload(incoming().request, "frame"), {
    ok: false,
    reason: "refused",
    status: 403,
    message: "Not for you.",
  });
  backend(
    Response.json(
      { error: { code: "unauthenticated", message: "Sign in." } },
      { status: 401 },
    ),
  );
  const dead = await receiveUpload(incoming().request, "frame");
  assert.equal(dead.ok ? null : dead.reason, "session");
  globalThis.fetch = (async () => {
    throw new TypeError("fetch failed");
  }) as unknown as typeof fetch;
  const originalError = console.error;
  console.error = () => {};
  try {
    const down = await receiveUpload(incoming().request, "frame");
    assert.equal(down.ok ? null : down.reason, "failed");
    assert.equal(down.ok ? 0 : down.status, 502);
  } finally {
    console.error = originalError;
  }
});
