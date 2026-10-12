import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import * as z from "zod";
import { SermoError } from "./errors";
import { callWith, sermoCookies } from "./transport";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  console.error = realError;
});
const realError = console.error;

const get = {
  name: "threads.get",
  input: z.object({ threadId: z.number() }),
  output: z.object({ title: z.string() }),
};
const create = {
  name: "threads.create",
  input: z.object({ nodeId: z.number(), title: z.string() }),
  output: z.object({ id: z.number() }),
};

function fake(response: Response) {
  const seen: { url: string; init: RequestInit }[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    seen.push({ url, init });
    return response;
  }) as unknown as typeof fetch;
  return seen;
}

test("only the sermo cookies and the visitor's identity are forwarded", async () => {
  const seen = fake(Response.json({ title: "Hi" }));
  const result = await callWith(
    {
      cookie:
        "theme=dark; sermo.session_token=abc; forum_lite=all; __Secure-sermo.session_data=def",
      userAgent: "agent/1",
      clientIp: "198.51.100.4",
    },
    get,
    { threadId: 5 },
  );
  assert.deepEqual(result, { title: "Hi" });
  assert.equal(seen[0].url, "http://127.0.0.1:8787/api/v1/threads/5");
  const headers = new Headers(seen[0].init.headers);
  assert.equal(
    headers.get("cookie"),
    "sermo.session_token=abc; __Secure-sermo.session_data=def",
  );
  assert.equal(headers.get("origin"), "http://localhost:3000");
  assert.equal(headers.get("user-agent"), "agent/1");
  assert.equal(headers.get("x-forwarded-for"), "198.51.100.4");
  assert.equal(headers.get("content-type"), null);
  assert.equal(seen[0].init.cache, "no-store");
  assert.equal(seen[0].init.method, "GET");
});

test("a write carries a JSON body and its content type", async () => {
  const seen = fake(Response.json({ id: 9 }, { status: 201 }));
  await callWith({}, create, { nodeId: 2, title: "T" });
  const headers = new Headers(seen[0].init.headers);
  assert.equal(seen[0].init.method, "POST");
  assert.equal(seen[0].url, "http://127.0.0.1:8787/api/v1/nodes/2/threads");
  assert.equal(headers.get("content-type"), "application/json");
  assert.equal(headers.get("cookie"), null);
  assert.equal(seen[0].init.body, JSON.stringify({ title: "T" }));
});

test("an error body becomes a SermoError", async () => {
  fake(
    Response.json(
      {
        error: {
          code: "validation",
          message: "Bad input",
          issues: [{ path: ["title"], message: "Required" }],
        },
      },
      { status: 400 },
    ),
  );
  await assert.rejects(callWith({}, get, { threadId: 1 }), (error) => {
    assert.ok(error instanceof SermoError);
    assert.equal(error.code, "validation");
    assert.equal(error.status, 400);
    assert.equal(error.message, "Bad input");
    assert.equal(error.issues?.[0].message, "Required");
    return true;
  });
});

test("a network failure and a non-JSON answer are internal errors", async () => {
  globalThis.fetch = (async () => {
    throw new TypeError("fetch failed");
  }) as unknown as typeof fetch;
  await assert.rejects(
    callWith({}, get, { threadId: 1 }),
    (error) => error instanceof SermoError && error.code === "internal",
  );
  fake(new Response("<html>", { status: 502 }));
  await assert.rejects(
    callWith({}, get, { threadId: 1 }),
    (error) =>
      error instanceof SermoError &&
      error.code === "internal" &&
      error.status === 502,
  );
});

test("a success body that breaks the contract is rejected and named", async () => {
  fake(Response.json({ title: 12 }));
  console.error = () => {};
  await assert.rejects(
    callWith({}, get, { threadId: 1 }),
    (error) =>
      error instanceof SermoError &&
      error.code === "internal" &&
      error.message.includes("threads.get"),
  );
});

test("sermoCookies keeps nothing else", () => {
  assert.equal(sermoCookies(undefined), "");
  assert.equal(sermoCookies("a=1; sermo.x=2; notsermo.y=3"), "sermo.x=2");
});

test("a DELETE carries the JSON content type the backend requires of a signed-in write", async () => {
  const remove = {
    name: "reactions.remove",
    input: z.object({ contentType: z.string(), contentId: z.number() }),
    output: z.object({ total: z.number() }),
  };
  const seen = fake(Response.json({ total: 0 }));
  await callWith({ cookie: "sermo.session_token=abc" }, remove, {
    contentType: "post",
    contentId: 7,
  });
  const [sent] = seen;
  assert.ok(sent);
  const { url, init } = sent;
  assert.equal(init.method, "DELETE");
  assert.match(url, /\/api\/v1\/reactions\/post\/7$/);
  assert.equal(init.body, undefined);
  assert.equal(
    new Headers(init.headers).get("content-type"),
    "application/json",
  );
});

test("a read carries no content type", async () => {
  const seen = fake(Response.json({ title: "Hi" }));
  await callWith({}, get, { threadId: 5 });
  assert.equal(new Headers(seen[0]?.init.headers).get("content-type"), null);
});

test("an unreachable API is an internal error; any other rejection passes through untouched", async () => {
  globalThis.fetch = (async () => {
    throw new TypeError("fetch failed");
  }) as unknown as typeof fetch;
  await assert.rejects(
    callWith({}, get, { threadId: 5 }),
    (error) => error instanceof SermoError && error.code === "internal",
  );
  // What the framework throws to end a prerender must reach it as it is.
  const signal = Object.assign(new Error("prerender is complete"), {
    digest: "HANGING_PROMISE_REJECTION",
  });
  globalThis.fetch = (async () => {
    throw signal;
  }) as unknown as typeof fetch;
  await assert.rejects(
    callWith({}, get, { threadId: 5 }),
    (error) => error === signal,
  );
});
