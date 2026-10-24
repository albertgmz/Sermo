import { afterEach, expect, test } from "bun:test";
import { type Ctx, closeContext, flushVisits } from "@sermo/core";
import { createTestContext } from "@sermo/core/testing";
import { createApp } from "./app";

const contexts: Ctx[] = [];
afterEach(() => {
  for (const ctx of contexts.splice(0)) closeContext(ctx);
});

const GOOGLEBOT = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";

function setup() {
  const ctx = createTestContext();
  contexts.push(ctx);
  const app = createApp(ctx, { trustedProxyHeader: "x-forwarded-for" });
  const env = { requestIP: () => ({ address: "10.0.0.1", family: "IPv4" as const, port: 1 }) };
  const request = (path: string, init: RequestInit = {}) => app.request(path, init, env);
  const visitors = () =>
    ctx.sqlite
      .prepare<
        { visitor_key: string; user_id: number | null; robot: string | null; ip: string | null },
        []
      >("SELECT visitor_key, user_id, robot, ip FROM online_visitors ORDER BY id")
      .all();
  return { ctx, request, visitors };
}

test("a page view through the app is noted without a write, and written by the flush", async () => {
  const { ctx, request, visitors } = setup();
  const view = await request("/api/v1/online/counts", {
    headers: {
      "x-sermo-place": "forumList",
      "x-forwarded-for": "66.249.66.1",
      "user-agent": GOOGLEBOT,
    },
  });
  expect(view.status).toBe(200);
  expect(visitors()).toEqual([]);
  expect(await flushVisits(ctx)).toBe(1);
  expect(visitors()).toEqual([
    {
      visitor_key: expect.stringMatching(/^g:/),
      user_id: null,
      robot: "google",
      ip: "66.249.66.1",
    },
  ]);
});

test("a signed-in member's page view is noted under their account, not their address", async () => {
  const { ctx, request, visitors } = setup();
  const post = (path: string, body: object) =>
    request(path, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:3000",
        "x-forwarded-for": "198.51.100.9",
      },
      body: JSON.stringify(body),
    });
  const account = { email: "ada@example.test", password: "Password123!" };
  expect(
    (await post("/api/auth/sign-up/email", { name: "ada", username: "ada", ...account })).status,
  ).toBe(200);
  const signIn = await post("/api/auth/sign-in/email", account);
  expect(signIn.status).toBe(200);
  const cookie = signIn.headers
    .getSetCookie()
    .map((line) => line.split(";")[0])
    .join("; ");
  await flushVisits(ctx);
  const view = await request("/api/v1/online", {
    headers: { cookie, "x-sermo-place": "members", "x-forwarded-for": "198.51.100.9" },
  });
  expect(view.status).toBe(200);
  expect(visitors()).toEqual([]);
  await flushVisits(ctx);
  const userId = ctx.sqlite.prepare<{ id: number }, []>("SELECT id FROM users").get()!.id;
  expect(visitors()).toEqual([
    { visitor_key: `u:${userId}`, user_id: userId, robot: null, ip: null },
  ]);
});
