import { afterEach, expect, test } from "bun:test";
import type { Ctx } from "@sermo/core";
import { closeContext } from "@sermo/core";
import { createTestContext } from "@sermo/core/testing";
import { createApp } from "./app";

const contexts: Ctx[] = [];
let nextIp = 1;
afterEach(() => {
  for (const ctx of contexts.splice(0)) closeContext(ctx);
});

const PASSWORD = "Password123!";
const ORIGIN = "http://localhost:3000";

async function setup() {
  const ctx = createTestContext();
  contexts.push(ctx);
  const app = createApp(ctx, { trustedProxyHeader: null });
  const send = (path: string, init: RequestInit = {}) =>
    app.request(path, init, {
      requestIP: () => ({ address: `10.9.0.${nextIp++}`, family: "IPv4" as const, port: 1 }),
    });
  const signUp = await send("/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN },
    body: JSON.stringify({
      name: "Boss",
      username: "Boss",
      email: "boss@example.test",
      password: PASSWORD,
    }),
  });
  expect(signUp.status).toBe(200);
  const cookie = signUp.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  const id = Number(((await signUp.json()) as { user: { id: string } }).user.id);
  ctx.sqlite.prepare("UPDATE users SET group_id = 4 WHERE id = ?1").run(id);
  const created = await send("/api/auth/api-key/create", {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN, cookie },
    body: JSON.stringify({ name: "script" }),
  });
  expect(created.status).toBe(200);
  const key = ((await created.json()) as { key: string }).key;
  const asSession = (method: string, path: string, body: object) =>
    send(`/api/v1${path}`, {
      method,
      headers: { "content-type": "application/json", origin: ORIGIN, cookie },
      body: JSON.stringify(body),
    });
  const asKey = (method: string, path: string, body: object) =>
    send(`/api/v1${path}`, {
      method,
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
    });
  const groups = () =>
    ctx.sqlite.prepare<{ n: number }, []>("SELECT count(*) AS n FROM groups").get()!.n;
  return { id, asSession, asKey, groups };
}

test("a browser session cannot change groups without the password; an API key can", async () => {
  const { asSession, asKey, groups } = await setup();
  const before = groups();

  const missing = await asSession("POST", "/groups", { title: "Helpers" });
  expect(missing.status).toBe(400);
  expect(await missing.json()).toMatchObject({
    error: { code: "validation", issues: [{ path: ["actorPassword"] }] },
  });
  expect(groups()).toBe(before);

  const wrong = await asSession("POST", "/groups", {
    title: "Helpers",
    actorPassword: "nope-nope-1",
  });
  expect(wrong.status).toBe(403);
  expect(groups()).toBe(before);

  const right = await asSession("POST", "/groups", { title: "Helpers", actorPassword: PASSWORD });
  expect(right.status).toBe(201);
  expect(groups()).toBe(before + 1);

  // The API key is exempt, and refused if it sends a password.
  expect((await asKey("POST", "/groups", { title: "Scripted" })).status).toBe(201);
  const keyed = await asKey("POST", "/groups", { title: "Keyed", actorPassword: PASSWORD });
  expect(keyed.status).toBe(403);
  expect(groups()).toBe(before + 2);
});

test("every guarded route holds a browser session to the password", async () => {
  const { id, asSession, asKey } = await setup();
  const group = (await (await asKey("POST", "/groups", { title: "Target" })).json()) as {
    id: number;
  };
  const promotion = (await (
    await asKey("POST", "/promotions", {
      title: "Rule",
      criteria: [{ criterion: "post_count", value: 1000 }],
      groupIds: [group.id],
    })
  ).json()) as { id: number };
  const refused = [
    asSession("PATCH", `/groups/${group.id}`, { title: "Renamed" }),
    asSession("PUT", `/users/${id}/groups`, { secondaryGroupIds: [group.id] }),
    asSession("PUT", "/permissions/entries", {
      groupId: group.id,
      entries: [{ permission: "forum.reply", value: "allow" }],
    }),
    asSession("POST", "/promotions", {
      title: "Second",
      criteria: [{ criterion: "post_count", value: 5 }],
      groupIds: [group.id],
    }),
    asSession("PATCH", `/promotions/${promotion.id}`, { title: "Renamed" }),
    asSession("PUT", `/users/${id}/promotions/${promotion.id}`, { action: "exempt" }),
  ];
  for (const response of await Promise.all(refused)) {
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { issues: [{ path: ["actorPassword"] }] },
    });
  }
});
