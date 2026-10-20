import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { viewerBody } from "@/lib/test-viewer";

const realFetch = globalThis.fetch;
const before = process.env.SERMO_PUBLIC_URL;
const SITE = "https://forum.example.test";
let sent = new Headers();
mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  headers: async () => sent,
  cookies: async () => ({ get: () => undefined }),
}));
const { POST } = await import("./route");

type Asked = { method: string; path: string; body: unknown };
let asked: Asked[] = [];
let refuse = false;

beforeEach(() => {
  process.env.SERMO_PUBLIC_URL = SITE;
  asked = [];
  refuse = false;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    const path = new URL(url).pathname;
    // The session is confirmed first (auth.me); only the writes are recorded.
    if (path === "/api/v1/me") return Response.json(viewerBody(true));
    asked.push({
      method: String(init.method ?? "GET"),
      path,
      body: init.body ? JSON.parse(String(init.body)) : null,
    });
    return refuse
      ? Response.json(
          { error: { code: "unauthenticated", message: "Sign in" } },
          { status: 401 },
        )
      : Response.json({ ok: true });
  }) as unknown as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  if (before === undefined) delete process.env.SERMO_PUBLIC_URL;
  else process.env.SERMO_PUBLIC_URL = before;
});

const KEYS = {
  p256dh: `B${"a".repeat(86)}`,
  auth: `${"b".repeat(21)}A`,
};
const NEW = "https://fcm.googleapis.com/fcm/send/new";
const OLD = "https://fcm.googleapis.com/fcm/send/old";

function renew(body: unknown, origin: string | null = SITE) {
  const headers = new Headers({
    "content-type": "application/json",
    "user-agent": "Test browser",
    cookie: "__Secure-sermo.session_token=tok",
  });
  if (origin !== null) headers.set("origin", origin);
  sent = headers;
  return POST(
    new Request(`${SITE}/push/subscription`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }),
  );
}

test("a renewed subscription is saved on the account in place of the old one", async () => {
  const response = await renew({ previous: OLD, endpoint: NEW, keys: KEYS });
  expect(response.status).toBe(200);
  expect(asked.map((call) => call.body)).toEqual([
    { endpoint: NEW, keys: KEYS, userAgent: "Test browser" },
    { endpoint: OLD },
  ]);
  // A subscription the browser kept is not removed after saving it again.
  asked = [];
  await renew({ previous: NEW, endpoint: NEW, keys: KEYS });
  expect(asked.map((call) => call.body)).toEqual([
    { endpoint: NEW, keys: KEYS, userAgent: "Test browser" },
  ]);
});

test("the backend's refusal is answered, so the worker takes the subscription back", async () => {
  refuse = true;
  const response = await renew({ previous: OLD, endpoint: NEW, keys: KEYS });
  expect(response.status).toBe(401);
  expect(await response.json()).toEqual({ ok: false });
  // The old one is not removed for a visitor the account did not take.
  expect(asked).toHaveLength(1);
});

test("a request from another site, or one that is no subscription, reaches no backend", async () => {
  expect(
    (await renew({ endpoint: NEW, keys: KEYS }, "https://evil.test")).status,
  ).toBe(403);
  expect((await renew({ endpoint: NEW, keys: KEYS }, null)).status).toBe(403);
  expect((await renew({ endpoint: NEW })).status).toBe(400);
  expect((await renew(null)).status).toBe(400);
  expect(asked).toEqual([]);
});
