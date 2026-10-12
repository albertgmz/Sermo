import { afterEach, mock, spyOn, test } from "bun:test";
import assert from "node:assert/strict";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const incoming = new Headers({
  cookie: "theme=dark; sermo.session_token=abc",
  "user-agent": "agent/1",
  "x-forwarded-for": "203.0.113.9, 198.51.100.4",
});
mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  headers: async () => incoming,
  cookies: async () => ({ set: () => {} }),
}));

const { getNavigation } = await import("./navigation");

const home = { id: 1, title: "Start", target: "/", builtin: "header.home" };
const answer = {
  header: [{ ...home, children: [] }],
  mobile: [],
  account: [],
  footer: [
    {
      id: 2,
      title: "Community",
      target: null,
      builtin: "footer.community",
      children: [
        {
          id: 3,
          title: "Boards",
          target: "/forums",
          builtin: "footer.community.forums",
        },
      ],
    },
  ],
};

test("the answer is passed through and asked with the visitor's cookies", async () => {
  const seen: { url: string; headers: Headers }[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    seen.push({ url, headers: new Headers(init.headers) });
    return Response.json(answer);
  }) as unknown as typeof fetch;
  assert.deepEqual(await getNavigation(), answer);
  assert.ok(seen[0].url.endsWith("/api/v1/navigation"));
  assert.equal(seen[0].headers.get("cookie"), "sermo.session_token=abc");
  assert.equal(seen[0].headers.get("x-forwarded-for"), "198.51.100.4");
});

test("an unreachable backend gives four empty lists and is logged outside the build only", async () => {
  globalThis.fetch = (async () => {
    throw new Error("refused");
  }) as unknown as typeof fetch;
  const logged = spyOn(console, "error").mockImplementation(() => {});
  const phase = process.env.NEXT_PHASE;
  const empty = { header: [], mobile: [], account: [], footer: [] };
  try {
    process.env.NEXT_PHASE = "phase-production-server";
    assert.deepEqual(await getNavigation(), empty);
    assert.equal(logged.mock.calls.length, 1);

    process.env.NEXT_PHASE = "phase-production-build";
    assert.deepEqual(await getNavigation(), empty);
    assert.equal(logged.mock.calls.length, 1);
  } finally {
    if (phase === undefined) delete process.env.NEXT_PHASE;
    else process.env.NEXT_PHASE = phase;
    logged.mockRestore();
  }
});

test("an answer that breaks the contract also gives the empty lists", async () => {
  globalThis.fetch = (async () =>
    Response.json({ header: "nope" })) as unknown as typeof fetch;
  const logged = spyOn(console, "error").mockImplementation(() => {});
  try {
    assert.deepEqual(await getNavigation(), {
      header: [],
      mobile: [],
      account: [],
      footer: [],
    });
  } finally {
    logged.mockRestore();
  }
});
