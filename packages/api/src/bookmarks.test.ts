import { afterEach, expect, test } from "bun:test";
import type { Ctx } from "@sermo/core";
import { closeContext, execute, getOperation, invalidate } from "@sermo/core";
import { createTestContext, insertNode, userActor } from "@sermo/core/testing";
import { createApp } from "./app";

const ORIGIN = "http://localhost:3000";
const PASSWORD = "Password123!";
const contexts: Ctx[] = [];
let nextIp = 1;
afterEach(() => {
  for (const ctx of contexts.splice(0)) closeContext(ctx);
});

async function setup() {
  const ctx = createTestContext();
  contexts.push(ctx);
  const app = createApp(ctx, { trustedProxyHeader: null });
  const send = (path: string, init: RequestInit = {}) =>
    app.request(path, init, {
      requestIP: () => ({ address: `10.8.0.${nextIp++}`, family: "IPv4" as const, port: 1 }),
    });
  const signUp = await send("/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN },
    body: JSON.stringify({
      name: "Reader",
      username: "Reader",
      email: "reader@example.test",
      password: PASSWORD,
    }),
  });
  expect(signUp.status).toBe(200);
  const cookie = signUp.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  const id = Number(((await signUp.json()) as { user: { id: string } }).user.id);
  const created = await send("/api/auth/api-key/create", {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN, cookie },
    body: JSON.stringify({ name: "script", password: PASSWORD }),
  });
  expect(created.status).toBe(200);
  const key = ((await created.json()) as { key: string }).key;
  const call = (method: string, path: string, body?: object, signedIn = true) =>
    send(`/api/v1${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        ...(signedIn ? { authorization: `Bearer ${key}` } : {}),
      },
      body: body && JSON.stringify(body),
    });
  const node = insertNode(ctx, {});
  invalidate(ctx, "node_tree");
  const made = await execute(ctx, getOperation("threads.create"), userActor({ id, groupId: 2 }), {
    nodeId: node.id,
    title: "A thread",
    body: "Opening post",
  });
  return { ctx, call, threadId: made.thread.id as number };
}

test("the three bookmark routes set, report and list a bookmark", async () => {
  const { call, threadId } = await setup();
  const status = (ids: number[], signedIn = true) =>
    call(
      "GET",
      `/bookmarks/status?contentType=thread&${ids.map((id) => `ids=${id}`).join("&")}`,
      undefined,
      signedIn,
    );

  const set = await call("PUT", "/bookmarks", {
    contentType: "thread",
    contentId: threadId,
    bookmarked: true,
  });
  expect(set.status).toBe(200);
  expect(await set.json()).toEqual({ ok: true });

  const found = await status([threadId, threadId + 100]);
  expect(found.status).toBe(200);
  expect(await found.json()).toEqual({ bookmarked: [threadId] });

  const listed = await call("GET", "/bookmarks?limit=5");
  expect(listed.status).toBe(200);
  expect(await listed.json()).toMatchObject({
    items: [{ contentType: "thread", contentId: threadId, threadId, title: "A thread" }],
    nextCursor: null,
  });

  const removed = await call("PUT", "/bookmarks", {
    contentType: "thread",
    contentId: threadId,
    bookmarked: false,
  });
  expect(removed.status).toBe(200);
  expect(await (await status([threadId])).json()).toEqual({ bookmarked: [] });
});

test("guests get an empty status and no write or list; an unseen item is a 404", async () => {
  const { call, threadId } = await setup();
  const guest = await call(
    "GET",
    `/bookmarks/status?contentType=thread&ids=${threadId}`,
    undefined,
    false,
  );
  expect(guest.status).toBe(200);
  expect(await guest.json()).toEqual({ bookmarked: [] });
  const body = { contentType: "thread", contentId: threadId, bookmarked: true };
  expect((await call("PUT", "/bookmarks", body, false)).status).toBe(401);
  expect((await call("GET", "/bookmarks", undefined, false)).status).toBe(401);
  expect((await call("PUT", "/bookmarks", { ...body, contentId: 99999 })).status).toBe(404);
});

test("status takes 100 ids and refuses 101", async () => {
  const { call } = await setup();
  const ask = (count: number) =>
    call(
      "GET",
      `/bookmarks/status?contentType=thread&${Array.from({ length: count }, (_, i) => `ids=${i + 1}`).join("&")}`,
    );
  expect((await ask(100)).status).toBe(200);
  expect((await ask(101)).status).toBe(400);
});
