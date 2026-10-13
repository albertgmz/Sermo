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
    body: JSON.stringify({ name: "script", password: PASSWORD }),
  });
  expect(created.status).toBe(200);
  const key = ((await created.json()) as { key: string }).key;
  const asSession = (method: string, path: string, body?: object) =>
    send(`/api/v1${path}`, {
      method,
      headers: { "content-type": "application/json", origin: ORIGIN, cookie },
      body: body && JSON.stringify(body),
    });
  const asKey = (method: string, path: string, body: object) =>
    send(`/api/v1${path}`, {
      method,
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
    });
  const groups = () =>
    ctx.sqlite.prepare<{ n: number }, []>("SELECT count(*) AS n FROM groups").get()!.n;
  return { id, ctx, asSession, asKey, groups };
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
  expect(await wrong.json()).toMatchObject({
    error: { code: "forbidden", issues: [{ path: ["actorPassword"] }] },
  });
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

test("a DELETE takes the password from its JSON body, or from the query as before", async () => {
  const { asSession, asKey, groups } = await setup();
  const make = async (title: string) =>
    ((await (await asKey("POST", "/groups", { title })).json()) as { id: number }).id;
  const before = groups();

  const inBody = await make("By body");
  expect((await asSession("DELETE", `/groups/${inBody}`, {})).status).toBe(400);
  expect((await asSession("DELETE", `/groups/${inBody}`, { actorPassword: PASSWORD })).status).toBe(
    200,
  );

  const inQuery = await make("By query");
  const queried = await asSession("DELETE", `/groups/${inQuery}?actorPassword=${PASSWORD}`);
  expect(queried.status).toBe(200);
  expect(groups()).toBe(before);
});

test("a field in both the body and the query of a DELETE takes the body's value", async () => {
  const { asSession, asKey, groups } = await setup();
  const make = async (title: string) =>
    ((await (await asKey("POST", "/groups", { title })).json()) as { id: number }).id;
  const first = await make("First");
  const before = groups();

  const wrongBody = await asSession("DELETE", `/groups/${first}?actorPassword=${PASSWORD}`, {
    actorPassword: "nope-nope-1",
  });
  expect(wrongBody.status).toBe(403);
  expect(groups()).toBe(before);

  const rightBody = await asSession("DELETE", `/groups/${first}?actorPassword=nope-nope-1`, {
    actorPassword: PASSWORD,
  });
  expect(rightBody.status).toBe(200);
  expect(groups()).toBe(before - 1);
});

test("a promotion is deleted with the password in the body, and a path parameter beats a body one", async () => {
  const { ctx, asSession, asKey } = await setup();
  const group = (await (await asKey("POST", "/groups", { title: "Target" })).json()) as {
    id: number;
  };
  const rule = async (title: string) =>
    (
      (await (
        await asKey("POST", "/promotions", {
          title,
          criteria: [{ criterion: "post_count", value: 1000 }],
          groupIds: [group.id],
        })
      ).json()) as { id: number }
    ).id;
  const kept = await rule("Kept");
  const removed = await rule("Removed");
  const response = await asSession("DELETE", `/promotions/${removed}`, {
    promotionId: kept,
    actorPassword: PASSWORD,
  });
  expect(response.status).toBe(200);
  // The removal is queued, for the rule in the path.
  const queued = ctx.sqlite
    .prepare<{ payload: string }, []>("SELECT payload FROM jobs WHERE type = 'promotions.delete'")
    .all()
    .map((row) => (JSON.parse(row.payload) as { promotionId: number }).promotionId);
  expect(queued).toEqual([removed]);
});

test("missing, wrong and too many wrong passwords all name the password field, under their own codes", async () => {
  const { asSession } = await setup();
  const outcome = async (body: object) => {
    const response = await asSession("POST", "/groups", { title: "Helpers", ...body });
    const { error } = (await response.json()) as {
      error: { code: string; issues?: { path: string[] }[] };
    };
    return [response.status, error.code, error.issues?.map((issue) => issue.path)];
  };
  expect(await outcome({})).toEqual([400, "validation", [["actorPassword"]]]);
  for (let i = 0; i < 5; i++)
    expect(await outcome({ actorPassword: "nope-nope-1" })).toEqual([
      403,
      "forbidden",
      [["actorPassword"]],
    ]);
  expect(await outcome({ actorPassword: "nope-nope-1" })).toEqual([
    429,
    "rate_limited",
    [["actorPassword"]],
  ]);
  // The right password is refused as well once the session has used its guesses up.
  expect(await outcome({ actorPassword: PASSWORD })).toEqual([
    429,
    "rate_limited",
    [["actorPassword"]],
  ]);
});
