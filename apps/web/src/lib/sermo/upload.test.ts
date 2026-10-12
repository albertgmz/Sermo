import { afterEach, mock, test } from "bun:test";
import assert from "node:assert/strict";
import { SermoError } from "./errors";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

mock.module("server-only", () => ({}));

const { isUploadPurpose, uploadWith } = await import("./upload");

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
  for (const purpose of ["attachment", "frame", "", "Avatar"]) {
    await assert.rejects(
      uploadWith({}, purpose as "avatar", source()),
      (error) => error instanceof SermoError && error.code === "validation",
    );
  }
  assert.equal(seen.length, 0);
  assert.equal(isUploadPurpose("cover"), true);
  assert.equal(isUploadPurpose("attachment"), false);
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
