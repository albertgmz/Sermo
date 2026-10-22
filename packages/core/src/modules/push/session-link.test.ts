import { afterEach, expect, spyOn, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { insertNode } from "@sermo/core/testing";
import webPush from "web-push";
import type { Actor } from "../../actor";
import { invalidate } from "../../context";
import { UnauthenticatedError } from "../../errors";
import { execute } from "../../operation";
import { accounts, closeAll, PASSWORD } from "../admin/fixtures.test";
import { getAuth, purgeExpiredCredentialsBatch } from "../auth";
import { threadsCreateOp } from "../forums";
import { runDueJobs } from "../jobs";
import { configurePush, pushSubscribeOp } from ".";
import { deliverPush, type PushItem, registerPushJobs } from "./delivery";

afterEach(closeAll);

const ORIGIN = "http://localhost:3000";
const cert = readFileSync(new URL("./fixtures/test-cert.pem", import.meta.url));
const key = readFileSync(new URL("./fixtures/test-key.pem", import.meta.url));
// Better Auth keeps its request counts per address across contexts, so addresses are not reused.
let ip = 100;

const keys = () => ({
  p256dh: webPush.generateVAPIDKeys().publicKey,
  auth: randomBytes(16).toString("base64url"),
});
const device = (n: number) => ({
  endpoint: `https://fcm.googleapis.com/device-${n}`,
  keys: keys(),
  userAgent: "Bun test",
});

async function world() {
  const w = await accounts({ mail: true });
  configurePush(w.ctx, {
    vapid: { ...webPush.generateVAPIDKeys(), subject: "mailto:test@example.test" },
  });
  const founder = await w.register("Founder", 4);
  const member = await w.register("Member");
  const post = (path: string, body: unknown, cookie?: string) =>
    getAuth(w.ctx).handler(
      new Request(`${ORIGIN}/api/auth${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: ORIGIN,
          "x-sermo-client-ip": `192.0.2.${ip++}`,
          ...(cookie ? { cookie } : {}),
        },
        body: JSON.stringify(body),
      }),
    );
  const cookieOf = (response: Response) =>
    response.headers
      .getSetCookie()
      .filter((value) => !/max-age=0/i.test(value))
      .map((value) => value.split(";")[0])
      .join("; ");
  /** Signs the member in (a new session) and returns its id and cookie. */
  const login = async () => {
    const response = await post("/sign-in/email", {
      email: "member@example.test",
      password: PASSWORD,
    });
    expect(response.status).toBe(200);
    const id = w.ctx.sqlite
      .prepare<{ id: number }, [number]>(
        "SELECT max(id) AS id FROM auth_session WHERE user_id = ?1",
      )
      .get(member.id)!.id;
    return { id, cookie: cookieOf(response) };
  };
  const asSession = (sessionId: number): Actor => ({
    kind: "user",
    userId: member.id,
    groupId: member.groupId,
    sessionId,
  });
  const save = (sessionId: number, n: number) =>
    execute(w.ctx, pushSubscribeOp, asSession(sessionId), device(n));
  /** The endpoint numbers still stored for the member. */
  const stored = () =>
    w.ctx.sqlite
      .prepare<{ endpoint: string }, [number]>(
        "SELECT endpoint FROM push_subscriptions WHERE user_id = ?1 ORDER BY id",
      )
      .all(member.id)
      .map((row) => Number(row.endpoint.split("-").pop()));
  const sessionOf = (n: number) =>
    w.ctx.sqlite
      .prepare<{ session_id: number | null }, [string]>(
        "SELECT session_id FROM push_subscriptions WHERE endpoint = ?1",
      )
      .get(device(n).endpoint)?.session_id;
  return { ...w, founder, member, post, login, asSession, save, stored, sessionOf };
}

type World = Awaited<ReturnType<typeof world>>;

/** Two sessions, each with its own device. */
async function twoDevices(w: World) {
  const first = await w.login();
  const second = await w.login();
  await w.save(first.id, 1);
  await w.save(second.id, 2);
  expect(w.stored()).toEqual([1, 2]);
  return { first, second };
}

test("a subscription is linked to the session that saves it, and only a live session can save one", async () => {
  const w = await world();
  const first = await w.login();
  const second = await w.login();
  await w.save(first.id, 1);
  expect(w.sessionOf(1)).toBe(first.id);
  // The same device saved again from another session of the member moves to that session.
  const again = device(1);
  await execute(w.ctx, pushSubscribeOp, w.asSession(second.id), again);
  expect(w.sessionOf(1)).toBe(second.id);
  // Actors without a session (an API key, or built by hand) save an unlinked one.
  await execute(w.ctx, pushSubscribeOp, w.asSession(0), device(2));
  expect(w.sessionOf(2)).toBeNull();
  await execute(
    w.ctx,
    pushSubscribeOp,
    { kind: "token", userId: w.member.id, groupId: 2, tokenId: 1 },
    device(3),
  );
  expect(w.sessionOf(3)).toBeNull();
  // Saving a linked device again with an API key leaves it with its session.
  await execute(
    w.ctx,
    pushSubscribeOp,
    { kind: "token", userId: w.member.id, groupId: 2, tokenId: 1 },
    { ...device(1), keys: keys() },
  );
  expect(w.sessionOf(1)).toBe(second.id);
  // A session that ended while the request ran, or has expired, saves nothing.
  await expect(w.save(first.id + 1000, 4)).rejects.toBeInstanceOf(UnauthenticatedError);
  w.ctx.sqlite.prepare("UPDATE auth_session SET expires_at = 1 WHERE id = ?1").run(second.id);
  await expect(w.save(second.id, 5)).rejects.toBeInstanceOf(UnauthenticatedError);
  expect(w.stored()).toEqual([1, 2, 3]);
});

test("signing out takes that session's devices and no other", async () => {
  const w = await world();
  const { first } = await twoDevices(w);
  expect((await w.post("/sign-out", {}, first.cookie)).status).toBe(200);
  expect(w.stored()).toEqual([2]);
});

test("revoking another session from a device takes that session's devices", async () => {
  const w = await world();
  const { first, second } = await twoDevices(w);
  const token = w.ctx.sqlite
    .prepare<{ token: string }, [number]>("SELECT token FROM auth_session WHERE id = ?1")
    .get(second.id)!.token;
  expect((await w.post("/revoke-session", { token }, first.cookie)).status).toBe(200);
  expect(w.stored()).toEqual([1]);
});

test("a device saved again under a new session moves to it, so ending the old session keeps it", async () => {
  const w = await world();
  const old = await w.login();
  await w.save(old.id, 1);
  // A device saved before sessions were linked.
  await w.save(0, 2);
  expect(w.sessionOf(2)).toBeNull();
  // The browser signs in again (its cookie was lost; the old session is still alive) and saves the
  // devices the account already lists: an update of the member's own rows, no device added or
  // pushed out.
  const current = await w.login();
  await w.save(current.id, 1);
  await w.save(current.id, 2);
  expect([w.sessionOf(1), w.sessionOf(2)]).toEqual([current.id, current.id]);
  const token = w.ctx.sqlite
    .prepare<{ token: string }, [number]>("SELECT token FROM auth_session WHERE id = ?1")
    .get(old.id)!.token;
  expect((await w.post("/revoke-session", { token }, current.cookie)).status).toBe(200);
  expect(w.stored()).toEqual([1, 2]);
});

test("signing out the other sessions keeps only the current session's devices", async () => {
  const w = await world();
  const { first } = await twoDevices(w);
  expect((await w.post("/revoke-other-sessions", {}, first.cookie)).status).toBe(200);
  expect(w.stored()).toEqual([1]);
});

test("a staff member revoking one session, or all of them, takes the devices", async () => {
  const w = await world();
  const { first, second } = await twoDevices(w);
  await w.run("users.adminRevokeSessions", w.founder.actor, {
    userId: w.member.id,
    sessionId: first.id,
    reason: "Lost phone",
  });
  expect(w.stored()).toEqual([2]);
  await w.run("users.adminRevokeSessions", w.founder.actor, {
    userId: w.member.id,
    reason: "Lost phone",
  });
  expect(w.sessions(w.member.id)).toBe(0);
  expect(w.stored()).toEqual([]);
  expect(second.id).toBeGreaterThan(0);
});

test("a password change that signs the sessions out takes their devices", async () => {
  const w = await world();
  const { first } = await twoDevices(w);
  const changed = await w.post(
    "/change-password",
    { currentPassword: PASSWORD, newPassword: "Another-secret-9", revokeOtherSessions: true },
    first.cookie,
  );
  expect(changed.status).toBe(200);
  // Better Auth ends every session and opens a new one for the browser that changed it.
  expect(w.stored()).toEqual([]);
});

test("a password reset takes the devices of every session", async () => {
  const w = await world();
  await twoDevices(w);
  const authContext = await getAuth(w.ctx).$context;
  await authContext.internalAdapter.createVerificationValue({
    identifier: "reset-password:tok",
    value: String(w.member.id),
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  const reset = await w.post("/reset-password", { token: "tok", newPassword: "Another-secret-9" });
  expect(reset.status).toBe(200);
  expect(w.stored()).toEqual([]);
});

test("banning the member takes the devices", async () => {
  const w = await world();
  await twoDevices(w);
  const { revokeUserCredentials } = await import("../auth");
  await revokeUserCredentials(w.ctx, w.member.id);
  expect(w.stored()).toEqual([]);
});

test("the purge of expired sessions takes their devices", async () => {
  const w = await world();
  const { first } = await twoDevices(w);
  w.ctx.sqlite.prepare("UPDATE auth_session SET expires_at = 1 WHERE id = ?1").run(first.id);
  purgeExpiredCredentialsBatch(w.ctx);
  expect(w.stored()).toEqual([2]);
});

/** A thread the founder makes and a notice of it for the member, to push to their devices. */
async function notice(w: World): Promise<PushItem> {
  const node = insertNode(w.ctx, { title: "Updates" });
  invalidate(w.ctx, "node_tree");
  const made = await execute(w.ctx, threadsCreateOp, w.founder.actor, {
    nodeId: node.id,
    title: "Topic",
    body: "Body",
  });
  const id = w.ctx.sqlite
    .prepare<{ id: number }, [number, number, number, number]>(
      "INSERT INTO notifications (user_id,type,content_type,content_id,thread_id,created_at,updated_at) VALUES (?1,'thread_reply','thread',?2,?2,?3,?4) RETURNING id",
    )
    .get(w.member.id, made.thread.id, w.ctx.now(), w.ctx.now())!.id;
  return {
    notificationId: id,
    userId: w.member.id,
    type: "thread_reply",
    contentType: "thread",
    contentId: made.thread.id,
    threadId: made.thread.id,
    actorId: null,
    data: {},
  };
}

const defaults = { thread_reply: { inApp: true, email: false, push: true } };

test("a session that expired stops its device's pushes before the purge removes it, and a device saved before sessions were linked keeps getting them", async () => {
  const received: string[] = [];
  const server = Bun.serve({
    port: 0,
    tls: { cert, key },
    fetch(request) {
      received.push(new URL(request.url).pathname);
      return new Response(null, { status: 201 });
    },
  });
  try {
    const w = await world();
    configurePush(w.ctx, {
      vapid: { ...webPush.generateVAPIDKeys(), subject: "mailto:test@example.test" },
      testAllowedEndpointOrigin: `https://localhost:${server.port}`,
      testCa: cert,
    });
    registerPushJobs(w.ctx, { renderPhrase: () => ({ title: "Reply", bodyHtml: "<p>Body</p>" }) });
    const live = await w.login();
    const expiring = await w.login();
    const at = (name: string) => ({
      endpoint: `https://localhost:${server.port}/${name}`,
      keys: keys(),
      userAgent: "Bun test",
    });
    await execute(w.ctx, pushSubscribeOp, w.asSession(live.id), at("live"));
    await execute(w.ctx, pushSubscribeOp, w.asSession(expiring.id), at("expiring"));
    // A subscription made before the link existed: no session.
    await execute(w.ctx, pushSubscribeOp, w.asSession(0), at("legacy"));
    const item = await notice(w);

    deliverPush(w.ctx, [item], defaults);
    await runDueJobs(w.ctx, { limit: 20 });
    expect(received.sort()).toEqual(["/expiring", "/legacy", "/live"]);

    received.length = 0;
    w.ctx.sqlite.prepare("UPDATE auth_session SET expires_at = 1 WHERE id = ?1").run(expiring.id);
    // A job is queued once per notice and device: clear the finished ones to send the notice again.
    w.ctx.sqlite.prepare("DELETE FROM jobs WHERE status = 'done'").run();
    deliverPush(w.ctx, [item], defaults);
    await runDueJobs(w.ctx, { limit: 20 });
    expect(received.sort()).toEqual(["/legacy", "/live"]);
    // The expired session's device is forgotten, not only skipped.
    expect(
      w.ctx.sqlite
        .prepare<{ endpoint: string }, []>("SELECT endpoint FROM push_subscriptions ORDER BY id")
        .all()
        .map((row) => new URL(row.endpoint).pathname),
    ).toEqual(["/live", "/legacy"]);
  } finally {
    server.stop(true);
  }
});

test("no push is sent to a device whose session was signed out", async () => {
  const send = spyOn(globalThis, "fetch");
  try {
    const w = await world();
    registerPushJobs(w.ctx, { renderPhrase: () => ({ title: "Reply", bodyHtml: "<p>Body</p>" }) });
    const { first, second } = await twoDevices(w);
    const item = await notice(w);
    await w.post("/sign-out", {}, first.cookie);
    await w.post("/sign-out", {}, second.cookie);
    deliverPush(w.ctx, [item], defaults);
    expect(w.ctx.sqlite.prepare("SELECT id FROM jobs WHERE type = 'push.send'").get()).toBeNull();
    expect(send).not.toHaveBeenCalled();
  } finally {
    send.mockRestore();
  }
});

test("a device linked to a session that is gone (deleted with foreign keys off) is forgotten, not sent to", async () => {
  const send = spyOn(globalThis, "fetch");
  try {
    const w = await world();
    registerPushJobs(w.ctx, { renderPhrase: () => ({ title: "Reply", bodyHtml: "<p>Body</p>" }) });
    await w.save(0, 1);
    w.ctx.sqlite.run("PRAGMA foreign_keys = OFF");
    w.ctx.sqlite.run("UPDATE push_subscriptions SET session_id = 99999");
    w.ctx.sqlite.run("PRAGMA foreign_keys = ON");
    deliverPush(w.ctx, [await notice(w)], defaults);
    await runDueJobs(w.ctx, { limit: 20 });
    expect(send).not.toHaveBeenCalled();
    expect(w.stored()).toEqual([]);
  } finally {
    send.mockRestore();
  }
});

test("the viewer is told the session it is in, which the browser keeps to tell a new sign-in", async () => {
  const w = await world();
  const { id } = await w.login();
  expect((await w.run("auth.me", w.asSession(id))).user.sessionId).toBe(id);
  // An API key and an actor built by hand are in no session.
  expect(
    (
      await w.run("auth.me", {
        kind: "token",
        userId: w.member.id,
        groupId: 2,
        tokenId: 1,
      })
    ).user.sessionId,
  ).toBeNull();
  expect((await w.run("auth.me", w.asSession(0))).user.sessionId).toBeNull();
});
