import { afterEach, expect, spyOn, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer as createNetServer, type Server as NetServer, type Socket } from "node:net";
import { createServer as createTlsServer } from "node:tls";
import {
  createTestContext,
  expectNoTableScan,
  insertNode,
  insertUser,
  userActor,
} from "@sermo/core/testing";
import webPush from "web-push";
import { actorUserId, GUEST } from "../../actor";
import { invalidate } from "../../context";
import { writeTx } from "../../db/tx";
import { ForbiddenError, UnauthenticatedError, ValidationError } from "../../errors";
import { execute } from "../../operation";
import { threadsCreateOp } from "../forums";
import { runDueJobs } from "../jobs";
import { configurePush, pushListOp, pushPublicKeyOp, pushSubscribeOp, pushUnsubscribeOp } from ".";
import { deliverPush, type PushItem, pushPayload, registerPushJobs } from "./delivery";

const contexts: ReturnType<typeof createTestContext>[] = [];
const cert = readFileSync(new URL("./fixtures/test-cert.pem", import.meta.url));
const key = readFileSync(new URL("./fixtures/test-key.pem", import.meta.url));
afterEach(() => {
  for (const ctx of contexts.splice(0)) ctx.sqlite.close(true);
});

const fixture = () => {
  const ctx = createTestContext();
  contexts.push(ctx);
  configurePush(ctx, {
    vapid: { ...webPush.generateVAPIDKeys(), subject: "mailto:test@example.test" },
  });
  const author = userActor(insertUser(ctx));
  const recipient = userActor(insertUser(ctx));
  const other = userActor(insertUser(ctx));
  const node = insertNode(ctx, { title: "Updates" });
  invalidate(ctx, "node_tree");
  return { ctx, author, recipient, other, node };
};

const subscribeInput = (endpoint: string) => ({
  endpoint,
  keys: {
    p256dh: webPush.generateVAPIDKeys().publicKey,
    auth: randomBytes(16).toString("base64url"),
  },
  userAgent: "Bun test",
});

function notification(
  ctx: ReturnType<typeof createTestContext>,
  userId: number,
  threadId: number,
): PushItem {
  const id = ctx.sqlite
    .prepare<{ id: number }, [number, number, number, number]>(
      "INSERT INTO notifications (user_id,type,content_type,content_id,thread_id,created_at,updated_at) VALUES (?1,'thread_reply','thread',?2,?2,?3,?4) RETURNING id",
    )
    .get(userId, threadId, ctx.now(), ctx.now())!.id;
  return {
    notificationId: id,
    userId,
    type: "thread_reply",
    contentType: "thread",
    contentId: threadId,
    threadId,
    actorId: null,
    data: {},
  };
}

const defaults = { thread_reply: { inApp: true, email: false, push: true } };

test("subscription operations enforce authentication and endpoint ownership", async () => {
  const { ctx, recipient, other } = fixture();
  const input = subscribeInput("https://fcm.googleapis.com/device");
  expect((await execute(ctx, pushPublicKeyOp, GUEST, {})).publicKey).toBeTruthy();
  await expect(execute(ctx, pushSubscribeOp, GUEST, input)).rejects.toBeInstanceOf(
    UnauthenticatedError,
  );
  await execute(ctx, pushSubscribeOp, recipient, input);
  await expect(
    execute(ctx, pushSubscribeOp, recipient, subscribeInput("http://fcm.googleapis.com/device")),
  ).rejects.toBeInstanceOf(ValidationError);
  await expect(execute(ctx, pushListOp, GUEST, {})).rejects.toBeInstanceOf(UnauthenticatedError);
  await expect(
    execute(ctx, pushSubscribeOp, other, {
      ...input,
      keys: { ...input.keys, auth: randomBytes(16).toString("base64url") },
    }),
  ).rejects.toBeInstanceOf(ForbiddenError);
  await execute(ctx, pushUnsubscribeOp, other, { endpoint: input.endpoint });
  expect(
    ctx.sqlite
      .prepare<{ user_id: number }, [string]>(
        "SELECT user_id FROM push_subscriptions WHERE endpoint = ?1",
      )
      .get(input.endpoint)?.user_id,
  ).toBe(actorUserId(recipient)!);
  await execute(ctx, pushSubscribeOp, other, input);
  expect((await execute(ctx, pushListOp, recipient, {})).items).toHaveLength(0);
  expect((await execute(ctx, pushListOp, other, {})).items[0]?.endpoint).toBe(input.endpoint);
  await execute(ctx, pushUnsubscribeOp, recipient, { endpoint: input.endpoint });
  expect((await execute(ctx, pushListOp, other, {})).items).toHaveLength(1);
  await execute(ctx, pushUnsubscribeOp, other, { endpoint: input.endpoint });
  expect(
    ctx.sqlite.prepare("SELECT id FROM push_subscriptions WHERE endpoint = ?1").get(input.endpoint),
  ).toBeNull();
  expectNoTableScan(ctx, "SELECT id FROM push_subscriptions WHERE user_id = ?1 ORDER BY id", [
    actorUserId(recipient)!,
  ]);
  expectNoTableScan(ctx, "SELECT id,user_id,auth FROM push_subscriptions WHERE endpoint = ?1", [
    input.endpoint,
  ]);
  expectNoTableScan(
    ctx,
    "SELECT push FROM notification_preferences WHERE user_id = ?1 AND type = ?2",
    [actorUserId(recipient)!, "thread_reply"],
  );
  expectNoTableScan(ctx, "SELECT id FROM notifications WHERE id = ?1 AND user_id = ?2", [
    1,
    actorUserId(recipient)!,
  ]);
  expectNoTableScan(
    ctx,
    "SELECT endpoint,user_agent,created_at FROM push_subscriptions WHERE user_id = ?1 ORDER BY id",
    [actorUserId(recipient)!],
  );
});

test("payload phrases are plain text, capped, and conversation bodies obey privacy", () => {
  const item = {
    notificationId: 1,
    userId: 1,
    type: "conversation_reply",
    contentType: "conversation_message",
    contentId: 2,
    threadId: null,
    actorId: 3,
    data: {},
  };
  const phrase = {
    title: "New message",
    bodyHtml: `<p>${"private ".repeat(50)}<strong>text</strong></p>`,
    bodyWithoutContentHtml: "<p>A message arrived</p>",
  };
  expect(pushPayload(item, phrase, "https://forum.example.test/conversations/2", false)).toEqual({
    title: "New message",
    body: "A message arrived",
    url: "https://forum.example.test/conversations/2",
  });
  const withBody = pushPayload(item, phrase, "https://forum.example.test/conversations/2", true);
  expect(withBody.body.length).toBeLessThanOrEqual(180);
  expect(withBody.body.startsWith("private")).toBe(true);
  expect(withBody.body).not.toContain("<strong>");
  // Control characters are the worst case: JSON escapes each one as six bytes.
  const maximal = pushPayload(
    item,
    {
      title: "\u0001".repeat(200),
      bodyHtml: `<p>${"\u0001".repeat(178)} ${"\u0001".repeat(400)}</p>`,
    },
    `https://forum.example.test/${"a".repeat(2000)}`,
    true,
  );
  expect(maximal.title).toBe("\u0001".repeat(120));
  expect(maximal.body).toBe(`${"\u0001".repeat(178)}…`);
  // A push service accepts a 4096-byte encrypted record (RFC 8291).
  const request = webPush.generateRequestDetails(
    {
      endpoint: "https://fcm.googleapis.com/device",
      keys: subscribeInput("https://fcm.googleapis.com/device").keys,
    },
    JSON.stringify(maximal),
    {
      vapidDetails: { ...webPush.generateVAPIDKeys(), subject: "mailto:test@example.test" },
      contentEncoding: "aes128gcm",
    },
  );
  expect(request.body!.length).toBeLessThanOrEqual(4096);
});

test("service host allowlist, ten-device cap, and oldest-first list", async () => {
  const { ctx, recipient } = fixture();
  for (const endpoint of [
    "https://fcm.googleapis.com.evil.test/push",
    "https://user@fcm.googleapis.com/push",
    "https://fcm.googleapis.com:444/push",
    "https://127.0.0.1/push",
    "https://push.services.mozilla.com.evil.test/push",
  ]) {
    await expect(
      execute(ctx, pushSubscribeOp, recipient, subscribeInput(endpoint)),
    ).rejects.toBeInstanceOf(ValidationError);
  }
  for (let i = 0; i < 11; i++)
    await execute(
      ctx,
      pushSubscribeOp,
      recipient,
      subscribeInput(`https://fcm.googleapis.com/device-${i}`),
    );
  const items = (await execute(ctx, pushListOp, recipient, {})).items;
  expect(items).toHaveLength(10);
  expect(items[0]?.endpoint).toBe("https://fcm.googleapis.com/device-1");
  expect(items[9]?.endpoint).toBe("https://fcm.googleapis.com/device-10");
  expect(items[0]?.userAgent).toBe("Bun test");
  expect(items[0]?.createdAt).toBe(new Date(ctx.now()).toISOString());
  expectNoTableScan(
    ctx,
    "SELECT id FROM push_subscriptions WHERE user_id = ?1 ORDER BY id LIMIT ?2",
    [actorUserId(recipient)!, 10],
  );
});

test("disabled push and recipient preferences suppress jobs", async () => {
  const { ctx, author, recipient, node } = fixture();
  configurePush(ctx, { vapid: null });
  const made = await execute(ctx, threadsCreateOp, author, {
    nodeId: node.id,
    title: "Topic",
    body: "Body",
  });
  const item = notification(ctx, actorUserId(recipient)!, made.thread.id);
  await expect(
    execute(ctx, pushSubscribeOp, recipient, subscribeInput("https://fcm.googleapis.com/device")),
  ).rejects.toBeInstanceOf(ValidationError);
  configurePush(ctx, {
    vapid: { ...webPush.generateVAPIDKeys(), subject: "mailto:test@example.test" },
  });
  await execute(
    ctx,
    pushSubscribeOp,
    recipient,
    subscribeInput("https://fcm.googleapis.com/device"),
  );
  deliverPush(ctx, [item], defaults);
  expect(ctx.sqlite.prepare("SELECT id FROM jobs WHERE type = 'push.send'").get()).toBeNull();
  registerPushJobs(ctx, { renderPhrase: () => ({ title: "Reply", bodyHtml: "<p>Body</p>" }) });
  ctx.sqlite
    .prepare("INSERT INTO notification_preferences (user_id,type,push) VALUES (?1,?2,0)")
    .run(actorUserId(recipient)!, item.type);
  deliverPush(ctx, [item], defaults);
  expect(ctx.sqlite.prepare("SELECT id FROM jobs WHERE type = 'push.send'").get()).toBeNull();
  ctx.sqlite
    .prepare("UPDATE notification_preferences SET push = 1 WHERE user_id = ?1")
    .run(actorUserId(recipient)!);
  expect(() =>
    writeTx(ctx, () => {
      deliverPush(ctx, [item], defaults);
      throw new Error("rollback");
    }),
  ).toThrow("rollback");
  expect(ctx.sqlite.prepare("SELECT id FROM jobs WHERE type = 'push.send'").get()).toBeNull();
  deliverPush(ctx, [item], { thread_reply: { ...defaults.thread_reply, push: false } });
  expect(
    ctx.sqlite.prepare<{ id: number }, []>("SELECT id FROM jobs WHERE type = 'push.send'").get(),
  ).toBeTruthy();
});

test("encrypted push reaches a mock endpoint, then 410 removes the device", async () => {
  const received: { headers: Headers; bytes: Uint8Array }[] = [];
  let status = 201;
  const server = Bun.serve({
    port: 0,
    tls: { cert, key },
    async fetch(request) {
      received.push({
        headers: request.headers,
        bytes: new Uint8Array(await request.arrayBuffer()),
      });
      return new Response(null, { status });
    },
  });
  try {
    const { ctx, author, recipient, node } = fixture();
    configurePush(ctx, {
      vapid: { ...webPush.generateVAPIDKeys(), subject: "mailto:test@example.test" },
      testAllowedEndpointOrigin: `https://localhost:${server.port}`,
      testCa: cert,
    });
    registerPushJobs(ctx, {
      renderPhrase: () => ({
        title: "New reply",
        bodyHtml: "<p>A new <strong>reply</strong> arrived.</p>",
      }),
    });
    const input = subscribeInput(`https://localhost:${server.port}/push`);
    await execute(ctx, pushSubscribeOp, recipient, input);
    const made = await execute(ctx, threadsCreateOp, author, {
      nodeId: node.id,
      title: "Topic",
      body: "Body",
    });
    const item = notification(ctx, actorUserId(recipient)!, made.thread.id);
    deliverPush(ctx, [item], defaults);
    expect(await runDueJobs(ctx)).toBe(1);
    expect(received).toHaveLength(1);
    expect(received[0]!.headers.get("content-encoding")).toBe("aes128gcm");
    expect(received[0]!.headers.get("authorization")).toContain("vapid");
    expect(received[0]!.bytes.length).toBeGreaterThan(20);
    expect(Buffer.from(received[0]!.bytes).toString()).not.toContain("New reply");
    status = 410;
    deliverPush(ctx, [item], defaults);
    expect(await runDueJobs(ctx)).toBe(1);
    expect(
      ctx.sqlite
        .prepare("SELECT id FROM push_subscriptions WHERE user_id = ?1")
        .get(actorUserId(recipient)!),
    ).toBeNull();
  } finally {
    server.stop(true);
  }
});

test("5xx retries and deleted content is not sent", async () => {
  let calls = 0;
  const server = Bun.serve({
    port: 0,
    tls: { cert, key },
    fetch() {
      calls++;
      return new Response(null, { status: 503 });
    },
  });
  try {
    const { ctx, author, recipient, node } = fixture();
    configurePush(ctx, {
      vapid: { ...webPush.generateVAPIDKeys(), subject: "mailto:test@example.test" },
      testAllowedEndpointOrigin: `https://localhost:${server.port}`,
      testCa: cert,
    });
    registerPushJobs(ctx, {
      renderPhrase: () => ({ title: "Reply", bodyHtml: "<p>Body</p>" }),
    });
    await execute(
      ctx,
      pushSubscribeOp,
      recipient,
      subscribeInput(`https://localhost:${server.port}/push`),
    );
    const made = await execute(ctx, threadsCreateOp, author, {
      nodeId: node.id,
      title: "Topic",
      body: "Body",
    });
    const item = notification(ctx, actorUserId(recipient)!, made.thread.id);
    deliverPush(ctx, [item], defaults);
    expect(await runDueJobs(ctx)).toBe(1);
    expect(calls).toBe(1);
    expect(
      ctx.sqlite
        .prepare<{ status: string }, []>("SELECT status FROM jobs WHERE type = 'push.send'")
        .get()?.status,
    ).toBe("pending");
    ctx.clock.advance(30_000);
    ctx.sqlite.prepare("UPDATE threads SET state = 'deleted' WHERE id = ?1").run(made.thread.id);
    expect(await runDueJobs(ctx)).toBe(1);
    expect(calls).toBe(1);
  } finally {
    server.stop(true);
  }
});

test("profile-post push uses the profile module's followed privacy direction", async () => {
  let sends = 0;
  const server = Bun.serve({
    port: 0,
    tls: { cert, key },
    fetch() {
      sends++;
      return new Response(null, { status: 201 });
    },
  });
  try {
    const { ctx, author: owner, recipient } = fixture();
    const ownerId = actorUserId(owner)!;
    const recipientId = actorUserId(recipient)!;
    configurePush(ctx, {
      vapid: { ...webPush.generateVAPIDKeys(), subject: "mailto:test@example.test" },
      testAllowedEndpointOrigin: `https://localhost:${server.port}`,
      testCa: cert,
    });
    registerPushJobs(ctx, {
      renderPhrase: () => ({ title: "Wall update", bodyHtml: "<p>Update</p>" }),
    });
    await execute(
      ctx,
      pushSubscribeOp,
      recipient,
      subscribeInput(`https://localhost:${server.port}/push`),
    );
    ctx.sqlite
      .prepare("UPDATE users SET profile_view_privacy = 'followed' WHERE id = ?1")
      .run(ownerId);
    const postId = ctx.sqlite
      .prepare<{ id: number }, [number, number]>(
        "INSERT INTO profile_posts (profile_user_id,user_id,created_at,body_source,body_html) VALUES (?1,?1,?2,'Update','<p>Update</p>') RETURNING id",
      )
      .get(ownerId, ctx.now())!.id;
    const makeItem = (): PushItem => {
      const notificationId = ctx.sqlite
        .prepare<{ id: number }, [number, number, number]>(
          "INSERT INTO notifications (user_id,type,content_type,content_id,created_at,updated_at) VALUES (?1,'wall_update','profile_post',?2,?3,?3) RETURNING id",
        )
        .get(recipientId, postId, ctx.now())!.id;
      return {
        notificationId,
        userId: recipientId,
        type: "wall_update",
        contentType: "profile_post",
        contentId: postId,
        threadId: null,
        actorId: ownerId,
        data: {},
      };
    };
    const wallDefaults = { wall_update: { inApp: true, email: false, push: true } };
    ctx.sqlite
      .prepare("INSERT INTO user_follows (user_id,followed_id,created_at) VALUES (?1,?2,?3)")
      .run(recipientId, ownerId, ctx.now());
    deliverPush(ctx, [makeItem()], wallDefaults);
    expect(await runDueJobs(ctx)).toBe(1);
    expect(sends).toBe(0);
    ctx.sqlite
      .prepare("INSERT INTO user_follows (user_id,followed_id,created_at) VALUES (?1,?2,?3)")
      .run(ownerId, recipientId, ctx.now());
    deliverPush(ctx, [makeItem()], wallDefaults);
    expect(await runDueJobs(ctx)).toBe(1);
    expect(sends).toBe(1);
  } finally {
    server.stop(true);
  }
});

test("a failing device retries without resending to a successful device", async () => {
  const hits = { good: 0, bad: 0 };
  const server = Bun.serve({
    port: 0,
    tls: { cert, key },
    fetch(request) {
      const device = request.url.endsWith("/good") ? "good" : "bad";
      hits[device]++;
      return new Response(null, { status: device === "good" ? 201 : 503 });
    },
  });
  try {
    const { ctx, author, recipient, node } = fixture();
    configurePush(ctx, {
      vapid: { ...webPush.generateVAPIDKeys(), subject: "mailto:test@example.test" },
      testAllowedEndpointOrigin: `https://localhost:${server.port}`,
      testCa: cert,
    });
    registerPushJobs(ctx, {
      renderPhrase: () => ({ title: "Reply", bodyHtml: "<p>Body</p>" }),
    });
    await execute(
      ctx,
      pushSubscribeOp,
      recipient,
      subscribeInput(`https://localhost:${server.port}/good`),
    );
    await execute(
      ctx,
      pushSubscribeOp,
      recipient,
      subscribeInput(`https://localhost:${server.port}/bad`),
    );
    const made = await execute(ctx, threadsCreateOp, author, {
      nodeId: node.id,
      title: "Topic",
      body: "Body",
    });
    deliverPush(ctx, [notification(ctx, actorUserId(recipient)!, made.thread.id)], defaults);
    expect(await runDueJobs(ctx, { limit: 2 })).toBe(2);
    expect(hits).toEqual({ good: 1, bad: 1 });
    ctx.clock.advance(30_000);
    expect(await runDueJobs(ctx)).toBe(1);
    expect(hits).toEqual({ good: 1, bad: 2 });
  } finally {
    server.stop(true);
  }
});

test("permanent push responses finish the job and keep the device", async () => {
  let status = 400;
  let calls = 0;
  const server = Bun.serve({
    port: 0,
    tls: { cert, key },
    fetch() {
      calls++;
      return new Response(null, { status });
    },
  });
  try {
    const { ctx, author, recipient, node } = fixture();
    configurePush(ctx, {
      vapid: { ...webPush.generateVAPIDKeys(), subject: "mailto:test@example.test" },
      testAllowedEndpointOrigin: `https://localhost:${server.port}`,
      testCa: cert,
    });
    registerPushJobs(ctx, {
      renderPhrase: () => ({ title: "Reply", bodyHtml: "<p>Body</p>" }),
    });
    await execute(
      ctx,
      pushSubscribeOp,
      recipient,
      subscribeInput(`https://localhost:${server.port}/device`),
    );
    const made = await execute(ctx, threadsCreateOp, author, {
      nodeId: node.id,
      title: "Topic",
      body: "Body",
    });
    for (const code of [301, 400, 403, 413]) {
      status = code;
      deliverPush(ctx, [notification(ctx, actorUserId(recipient)!, made.thread.id)], defaults);
      expect(await runDueJobs(ctx)).toBe(1);
      const job = ctx.sqlite
        .prepare<{ status: string }, []>(
          "SELECT status FROM jobs WHERE type = 'push.send' ORDER BY id DESC LIMIT 1",
        )
        .get();
      expect(job?.status).toBe("done");
      const device = ctx.sqlite
        .prepare("SELECT id FROM push_subscriptions WHERE user_id = ?1")
        .get(actorUserId(recipient)!);
      expect(Boolean(device)).toBe(true);
    }
    expect(calls).toBe(4);
    await execute(
      ctx,
      pushSubscribeOp,
      recipient,
      subscribeInput(`https://localhost:${server.port}/device`),
    );
    ctx.sqlite
      .prepare("UPDATE push_subscriptions SET p256dh = 'invalid' WHERE user_id = ?1")
      .run(actorUserId(recipient)!);
    deliverPush(ctx, [notification(ctx, actorUserId(recipient)!, made.thread.id)], defaults);
    expect(await runDueJobs(ctx)).toBe(1);
    expect(
      ctx.sqlite
        .prepare<{ status: string }, []>(
          "SELECT status FROM jobs WHERE type = 'push.send' ORDER BY id DESC LIMIT 1",
        )
        .get()?.status,
    ).toBe("done");
    expect(calls).toBe(4);
  } finally {
    server.stop(true);
  }
});

test("send-time endpoint validation deletes a changed non-service URL", async () => {
  let calls = 0;
  const server = Bun.serve({
    port: 0,
    tls: { cert, key },
    fetch() {
      calls++;
      return new Response(null, { status: 201 });
    },
  });
  try {
    const { ctx, author, recipient, node } = fixture();
    configurePush(ctx, {
      vapid: { ...webPush.generateVAPIDKeys(), subject: "mailto:test@example.test" },
      testAllowedEndpointOrigin: `https://localhost:${server.port}`,
      testCa: cert,
    });
    registerPushJobs(ctx, {
      renderPhrase: () => ({ title: "Reply", bodyHtml: "<p>Body</p>" }),
    });
    await execute(
      ctx,
      pushSubscribeOp,
      recipient,
      subscribeInput(`https://localhost:${server.port}/device`),
    );
    const made = await execute(ctx, threadsCreateOp, author, {
      nodeId: node.id,
      title: "Topic",
      body: "Body",
    });
    deliverPush(ctx, [notification(ctx, actorUserId(recipient)!, made.thread.id)], defaults);
    ctx.sqlite
      .prepare(
        "UPDATE push_subscriptions SET endpoint = 'https://not-a-push-service.example/push' WHERE user_id = ?1",
      )
      .run(actorUserId(recipient)!);
    expect(await runDueJobs(ctx)).toBe(1);
    expect(calls).toBe(0);
    expect((await execute(ctx, pushListOp, recipient, {})).items).toHaveLength(0);
  } finally {
    server.stop(true);
  }
});

const BYPASS_ENDPOINTS = [
  "https://127.0.0.1;.googleapis.com/x",
  "https://10.0.0.5;.googleapis.com/x",
  "https://169.254.169.254;.push.apple.com/x",
  "https://localhost'.notify.windows.com/x",
  "https:fcm.googleapis.com/x",
];

test("malformed endpoints are rejected", async () => {
  const { ctx, recipient } = fixture();
  for (const endpoint of BYPASS_ENDPOINTS)
    await expect(
      execute(ctx, pushSubscribeOp, recipient, subscribeInput(endpoint)),
    ).rejects.toBeInstanceOf(ValidationError);
  expect((await execute(ctx, pushListOp, recipient, {})).items).toHaveLength(0);
});

test("endpoints are stored normalized and unsubscribe matches the same form", async () => {
  const { ctx, recipient } = fixture();
  await execute(
    ctx,
    pushSubscribeOp,
    recipient,
    subscribeInput("https://FCM.googleapis.com:443/device"),
  );
  expect((await execute(ctx, pushListOp, recipient, {})).items[0]?.endpoint).toBe(
    "https://fcm.googleapis.com/device",
  );
  await execute(ctx, pushUnsubscribeOp, recipient, {
    endpoint: "https://Fcm.GoogleApis.com/device",
  });
  expect((await execute(ctx, pushListOp, recipient, {})).items).toHaveLength(0);
});

test("stored malformed endpoints are deleted, not sent", async () => {
  const send = spyOn(globalThis, "fetch");
  try {
    const { ctx, author, recipient, node } = fixture();
    registerPushJobs(ctx, { renderPhrase: () => ({ title: "Reply", bodyHtml: "<p>Body</p>" }) });
    const made = await execute(ctx, threadsCreateOp, author, {
      nodeId: node.id,
      title: "Topic",
      body: "Body",
    });
    const keys = subscribeInput("https://fcm.googleapis.com/device").keys;
    for (const endpoint of BYPASS_ENDPOINTS)
      ctx.sqlite
        .prepare(
          "INSERT INTO push_subscriptions (user_id,endpoint,p256dh,auth,user_agent,created_at) VALUES (?1,?2,?3,?4,'',?5)",
        )
        .run(actorUserId(recipient)!, endpoint, keys.p256dh, keys.auth, ctx.now());
    deliverPush(ctx, [notification(ctx, actorUserId(recipient)!, made.thread.id)], defaults);
    expect(await runDueJobs(ctx, { limit: 10 })).toBe(BYPASS_ENDPOINTS.length);
    expect(send).not.toHaveBeenCalled();
    expect(
      ctx.sqlite
        .prepare("SELECT id FROM push_subscriptions WHERE user_id = ?1")
        .get(actorUserId(recipient)!),
    ).toBeNull();
    expect(
      ctx.sqlite.prepare("SELECT id FROM jobs WHERE type = 'push.send' AND status <> 'done'").get(),
    ).toBeNull();
  } finally {
    send.mockRestore();
  }
});

const TEST_TIMEOUT_MS = 500;

/** Sends one push to `origin` with a short deadline; the job must fail in time and retry. */
async function expectSendRetried(origin: string, attempts: () => number) {
  const { ctx, author, recipient, node } = fixture();
  configurePush(ctx, {
    vapid: { ...webPush.generateVAPIDKeys(), subject: "mailto:test@example.test" },
    testAllowedEndpointOrigin: origin,
    testCa: cert,
    testTimeoutMs: TEST_TIMEOUT_MS,
  });
  registerPushJobs(ctx, { renderPhrase: () => ({ title: "Reply", bodyHtml: "<p>Body</p>" }) });
  await execute(ctx, pushSubscribeOp, recipient, subscribeInput(`${origin}/device`));
  const made = await execute(ctx, threadsCreateOp, author, {
    nodeId: node.id,
    title: "Topic",
    body: "Body",
  });
  deliverPush(ctx, [notification(ctx, actorUserId(recipient)!, made.thread.id)], defaults);
  const job = () =>
    ctx.sqlite
      .prepare<{ status: string; attempts: number }, []>(
        "SELECT status,attempts FROM jobs WHERE type = 'push.send'",
      )
      .get();
  for (const attempt of [1, 2]) {
    const before = attempts();
    const started = performance.now();
    expect(await runDueJobs(ctx)).toBe(1);
    expect(performance.now() - started).toBeLessThan(TEST_TIMEOUT_MS + 1_500);
    expect(attempts()).toBeGreaterThan(before);
    expect(job()).toEqual({ status: "pending", attempts: attempt });
    ctx.clock.advance(30_000);
  }
}

async function listen(server: NetServer): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, resolve));
  return (server.address() as { port: number }).port;
}

test("a dropped connection retries the job", async () => {
  let connections = 0;
  const server = createTlsServer({ cert, key }, (socket) => {
    connections++;
    socket.destroy();
  });
  try {
    await expectSendRetried(`https://localhost:${await listen(server)}`, () => connections);
  } finally {
    server.close();
  }
});

test("a connection that never starts TLS times out and retries", async () => {
  const sockets: Socket[] = [];
  const server = createNetServer((socket) => {
    sockets.push(socket);
  });
  try {
    await expectSendRetried(`https://localhost:${await listen(server)}`, () => sockets.length);
  } finally {
    for (const socket of sockets) socket.destroy();
    server.close();
  }
});

test("an unreachable host times out and retries", async () => {
  let attempts = 0;
  const realFetch = globalThis.fetch;
  const send = spyOn(globalThis, "fetch").mockImplementation(((
    ...args: Parameters<typeof fetch>
  ) => {
    attempts++;
    return realFetch(...args);
  }) as typeof fetch);
  try {
    await expectSendRetried("https://10.255.255.1", () => attempts);
  } finally {
    send.mockRestore();
  }
});

test("response headers that trickle past the deadline retry", async () => {
  let connections = 0;
  const timers: ReturnType<typeof setInterval>[] = [];
  const server = createTlsServer({ cert, key }, (socket) => {
    connections++;
    socket.once("data", () => {
      socket.write("HTTP/1.1 201 Created\r\nX-Slow: ");
      timers.push(setInterval(() => socket.write("x"), 100));
    });
    socket.on("error", () => {});
  });
  try {
    await expectSendRetried(`https://localhost:${await listen(server)}`, () => connections);
  } finally {
    for (const timer of timers) clearInterval(timer);
    server.close();
  }
});

test("userinfo and malformed hosts are rejected without a server error", async () => {
  const { ctx, recipient } = fixture();
  for (const endpoint of [
    "https://a%@fcm.googleapis.com/x",
    "https://a%40b@fcm.googleapis.com/x",
    "https://other.googleapis.com/x",
    "https://-x.push.apple.com/x",
    "https://x-.push.apple.com/x",
  ])
    await expect(
      execute(ctx, pushSubscribeOp, recipient, subscribeInput(endpoint)),
    ).rejects.toBeInstanceOf(ValidationError);
});

test("the same secret transfers an endpoint with or without padding", async () => {
  const { ctx, recipient, other } = fixture();
  const input = subscribeInput("https://fcm.googleapis.com/device");
  await execute(ctx, pushSubscribeOp, recipient, input);
  await execute(ctx, pushSubscribeOp, other, {
    ...input,
    keys: { ...input.keys, auth: `${input.keys.auth}==` },
  });
  expect((await execute(ctx, pushListOp, recipient, {})).items).toHaveLength(0);
  expect((await execute(ctx, pushListOp, other, {})).items).toHaveLength(1);
  await execute(ctx, pushSubscribeOp, recipient, input);
  expect((await execute(ctx, pushListOp, recipient, {})).items).toHaveLength(1);
  expect((await execute(ctx, pushListOp, other, {})).items).toHaveLength(0);
});

test("a comment push reaches the parent post's author on a restricted wall", async () => {
  let sends = 0;
  const server = Bun.serve({
    port: 0,
    tls: { cert, key },
    fetch() {
      sends++;
      return new Response(null, { status: 201 });
    },
  });
  try {
    const { ctx, author: owner, recipient: postAuthor, other } = fixture();
    const ownerId = actorUserId(owner)!;
    const postAuthorId = actorUserId(postAuthor)!;
    configurePush(ctx, {
      vapid: { ...webPush.generateVAPIDKeys(), subject: "mailto:test@example.test" },
      testAllowedEndpointOrigin: `https://localhost:${server.port}`,
      testCa: cert,
    });
    registerPushJobs(ctx, {
      renderPhrase: () => ({ title: "New comment", bodyHtml: "<p>Comment</p>" }),
    });
    for (const member of [postAuthor, other])
      await execute(
        ctx,
        pushSubscribeOp,
        member,
        subscribeInput(`https://localhost:${server.port}/${actorUserId(member)}`),
      );
    const postId = ctx.sqlite
      .prepare<{ id: number }, [number, number, number]>(
        "INSERT INTO profile_posts (profile_user_id,user_id,created_at,body_source,body_html) VALUES (?1,?2,?3,'Hi','<p>Hi</p>') RETURNING id",
      )
      .get(ownerId, postAuthorId, ctx.now())!.id;
    const commentId = ctx.sqlite
      .prepare<{ id: number }, [number, number, number]>(
        "INSERT INTO profile_post_comments (profile_post_id,user_id,created_at,body_source,body_html) VALUES (?1,?2,?3,'Reply','<p>Reply</p>') RETURNING id",
      )
      .get(postId, ownerId, ctx.now())!.id;
    ctx.sqlite.prepare("UPDATE users SET profile_view_privacy = 'self' WHERE id = ?1").run(ownerId);
    const makeItem = (userId: number): PushItem => {
      const notificationId = ctx.sqlite
        .prepare<{ id: number }, [number, number, number]>(
          "INSERT INTO notifications (user_id,type,content_type,content_id,created_at,updated_at) VALUES (?1,'profile_post_comment','profile_post_comment',?2,?3,?3) RETURNING id",
        )
        .get(userId, commentId, ctx.now())!.id;
      return {
        notificationId,
        userId,
        type: "profile_post_comment",
        contentType: "profile_post_comment",
        contentId: commentId,
        threadId: null,
        actorId: ownerId,
        data: {},
      };
    };
    const commentDefaults = { profile_post_comment: { inApp: true, email: false, push: true } };
    deliverPush(ctx, [makeItem(actorUserId(other)!)], commentDefaults);
    expect(await runDueJobs(ctx)).toBe(1);
    expect(sends).toBe(0);
    deliverPush(ctx, [makeItem(postAuthorId)], commentDefaults);
    expect(await runDueJobs(ctx)).toBe(1);
    expect(sends).toBe(1);
  } finally {
    server.stop(true);
  }
});
