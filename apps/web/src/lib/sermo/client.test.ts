import { afterEach, mock, test } from "bun:test";
import assert from "node:assert/strict";
import * as z from "zod";
import lib from "../../../messages/en/lib.json";
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

mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async () => (key: string) =>
    (lib.errors as Record<string, string>)[key],
}));

const { errorMessage, read, readIfAllowed } = await import("./client");

const contract = {
  name: "threads.get",
  input: z.object({ threadId: z.number() }),
  output: z.object({ title: z.string() }),
};

function backend(response: Response) {
  globalThis.fetch = (async () => response) as unknown as typeof fetch;
}

const refusal = (status: number, code: string) =>
  Response.json({ error: { code, message: code } }, { status });

// notFound() and redirect() throw errors carrying a digest; that is what Next reads.
async function digestOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    const digest = (error as { digest?: unknown }).digest;
    if (typeof digest === "string") return digest;
    throw error;
  }
  throw new Error("expected read() to throw");
}

function redirectedTo(path?: string) {
  incoming = new Headers(path === undefined ? {} : { "x-sermo-path": path });
  backend(refusal(401, "unauthenticated"));
  return digestOf(read(contract, { threadId: 1 }));
}

test("a record that is found is returned", async () => {
  incoming = new Headers();
  backend(Response.json({ title: "Hi" }));
  assert.deepEqual(await read(contract, { threadId: 1 }), { title: "Hi" });
});

test("not_found is a 404", async () => {
  incoming = new Headers();
  backend(refusal(404, "not_found"));
  assert.match(
    await digestOf(read(contract, { threadId: 1 })),
    /^NEXT_HTTP_ERROR_FALLBACK;404/,
  );
});

test("unauthenticated goes to the login page with the path the visitor asked for", async () => {
  assert.match(
    await redirectedTo("/account?tab=x"),
    /^NEXT_REDIRECT;[a-z]+;\/login\?next=%2Faccount%3Ftab%3Dx;/,
  );
});

test("unauthenticated without a usable path goes to the plain login page", async () => {
  for (const path of [
    undefined,
    "",
    "//evil.example",
    "https://evil.example",
    "/login",
    "/register?x=1",
    "no-slash",
  ]) {
    assert.match(
      await redirectedTo(path),
      /^NEXT_REDIRECT;[a-z]+;\/login;/,
      String(path),
    );
  }
});

test("other errors are rethrown", async () => {
  incoming = new Headers();
  for (const [status, code] of [
    [403, "forbidden"],
    [500, "internal"],
  ] as const) {
    backend(refusal(status, code));
    await assert.rejects(
      read(contract, { threadId: 1 }),
      (error) => error instanceof SermoError && error.code === code,
    );
  }
});

test("a dead session cookie reads as a guest instead of being sent to sign in", async () => {
  incoming = new Headers({
    cookie: "sermo.session_token=dead; forum_lite=all",
    "x-sermo-path": "/threads/1",
  });
  const cookies: (string | null)[] = [];
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    const cookie = new Headers(init.headers).get("cookie");
    cookies.push(cookie);
    return cookie
      ? refusal(401, "unauthenticated")
      : Response.json({ title: "Public" });
  }) as unknown as typeof fetch;
  assert.deepEqual(await read(contract, { threadId: 1 }), { title: "Public" });
  assert.deepEqual(cookies, ["sermo.session_token=dead", null]);
});

test("what a guest may not read still leads to sign-in, also with a dead cookie", async () => {
  incoming = new Headers({
    cookie: "sermo.session_token=dead",
    "x-sermo-path": "/account",
  });
  globalThis.fetch = (async () =>
    refusal(401, "unauthenticated")) as unknown as typeof fetch;
  assert.match(
    await digestOf(read(contract, { threadId: 1 })),
    /^NEXT_REDIRECT;[a-z]+;\/login\?next=%2Faccount;/,
  );
});

test("a read that fails validation is a 404: the address asked for what cannot exist", async () => {
  incoming = new Headers();
  backend(refusal(400, "validation"));
  assert.match(
    await digestOf(read(contract, { threadId: 1 })),
    /^NEXT_HTTP_ERROR_FALLBACK;404/,
  );
});

test("a write that fails validation is still the caller's to report", async () => {
  incoming = new Headers();
  backend(refusal(400, "validation"));
  await assert.rejects(
    read({ ...contract, name: "threads.create" }, { nodeId: 1 } as never),
    (error) => error instanceof SermoError && error.code === "validation",
  );
});

test("a rate limit carries a digest the error page can tell it by", () => {
  assert.equal(
    new SermoError("rate_limited", 429, "slow down").digest,
    "sermo.rate_limited",
  );
  assert.equal(new SermoError("internal", 500, "x").digest, undefined);
});

test("a refusal of the backend is worded as the backend worded it", async () => {
  assert.equal(
    await errorMessage(
      new SermoError("forbidden", 403, "You may not do that."),
    ),
    "You may not do that.",
  );
  assert.equal(
    await errorMessage(
      new SermoError("validation", 422, "Invalid", [
        { message: "Too short" },
        { message: "Needs a digit" },
      ]),
    ),
    "Too short Needs a digit",
  );
});

test("an error of our own side never reaches the visitor, it is logged instead", async () => {
  const logged: unknown[][] = [];
  const realError = console.error;
  console.error = (...args: unknown[]) => {
    logged.push(args);
  };
  try {
    for (const detail of [
      "The API could not be reached: connect ECONNREFUSED 10.0.3.7:8787",
      "The answer of threads.get does not match its contract.",
      "The API answered 502.",
    ]) {
      assert.equal(
        await errorMessage(new SermoError("internal", 500, detail)),
        lib.errors.generic,
      );
    }
  } finally {
    console.error = realError;
  }
  assert.equal(logged.length, 3);
  assert.match(String((logged[0][1] as Error).message), /ECONNREFUSED/);
});

test("a block beside a page gets nothing, not a redirect or an error, where the backend refuses the visitor", async () => {
  incoming = new Headers();
  for (const [status, code] of [
    [401, "unauthenticated"],
    [403, "forbidden"],
  ] as const) {
    backend(refusal(status, code));
    assert.equal(await readIfAllowed(contract, { threadId: 1 }), null, code);
  }
  backend(Response.json({ title: "Hi" }));
  assert.deepEqual(await readIfAllowed(contract, { threadId: 1 }), {
    title: "Hi",
  });
});

test("a block beside a page still fails on a failure that is not about the visitor", async () => {
  incoming = new Headers();
  backend(refusal(500, "internal"));
  await assert.rejects(
    readIfAllowed(contract, { threadId: 1 }),
    (error) => error instanceof SermoError && error.code === "internal",
  );
});

test("a refusal for a missing acceptance is told apart and worded by the web app", async () => {
  const missing = new SermoError("forbidden", 403, "backend wording", [
    { path: ["acceptance"], message: "terms,rules" },
  ]);
  assert.equal(await errorMessage(missing), lib.errors.acceptanceRequired);
  assert.equal(
    await errorMessage(
      new SermoError("forbidden", 403, "You may not do that.", [
        { path: ["other"], message: "x" },
      ]),
    ),
    "You may not do that.",
  );
});

test("a refusal for an account waiting for approval is told apart and worded by the web app", async () => {
  const waiting = new SermoError("forbidden", 403, "backend wording", [
    { path: ["approval"], message: "awaiting" },
  ]);
  assert.equal(await errorMessage(waiting), lib.errors.approvalPending);
  // Only a forbidden refusal that names the issue: the path alone on another code is no such thing.
  assert.equal(
    await errorMessage(
      new SermoError("validation", 422, "Check the form.", [
        { path: ["approval"], message: "x" },
      ]),
    ),
    "x",
  );
});

test("a page view names its page to the backend, never its address; anything else names none", async () => {
  const sent: (string | null)[] = [];
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    sent.push(new Headers(init.headers).get("x-sermo-place"));
    return Response.json({ title: "Hi" });
  }) as unknown as typeof fetch;
  incoming = new Headers({ "x-sermo-path": "/threads/12-secret-title?page=2" });
  await read(contract, { threadId: 12 });
  // A request the proxy did not mark as a page view (an action, a route handler).
  incoming = new Headers();
  await read(contract, { threadId: 12 });
  // A visitor cannot name a place of their own: only the path is read.
  incoming = new Headers({ "x-sermo-place": "thread:99" });
  await read(contract, { threadId: 12 });
  assert.deepEqual(sent, ["thread:12", null, null]);
});
