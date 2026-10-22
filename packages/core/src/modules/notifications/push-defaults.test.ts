import { afterEach, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createTestContext, insertNode, insertUser, userActor } from "@sermo/core/testing";
import webPush from "web-push";
import { invalidate } from "../../context";
import { dispatchEvents } from "../../events";
import { execute } from "../../operation";
import { threadsCreateOp } from "../forums";
import { runDueJobs } from "../jobs";
import { configurePush, pushSubscribeOp, registerPushJobs } from "../push";
import { notificationPushPhrase, registerNotificationJobs } from "./index";

const cert = readFileSync(new URL("../push/fixtures/test-cert.pem", import.meta.url));
const key = readFileSync(new URL("../push/fixtures/test-key.pem", import.meta.url));
const cleanup: Array<() => void> = [];
afterEach(() => {
  for (const close of cleanup.splice(0)) close();
});

test("a member who turned pushes on is pushed a mention without choosing any type", async () => {
  const received: string[] = [];
  const server = Bun.serve({
    port: 0,
    tls: { cert, key },
    async fetch(request) {
      received.push(new URL(request.url).pathname);
      await request.arrayBuffer();
      return new Response(null, { status: 201 });
    },
  });
  const ctx = createTestContext();
  cleanup.push(() => {
    server.stop(true);
    ctx.sqlite.close(true);
  });
  const origin = `https://localhost:${server.port}`;
  registerNotificationJobs(ctx);
  configurePush(ctx, {
    vapid: { ...webPush.generateVAPIDKeys(), subject: "mailto:test@example.test" },
    testAllowedEndpointOrigin: origin,
    testCa: cert,
  });
  registerPushJobs(ctx, { renderPhrase: notificationPushPhrase(ctx) });
  const author = insertUser(ctx);
  const member = insertUser(ctx);
  const node = insertNode(ctx, {});
  invalidate(ctx, "node_tree");
  await execute(ctx, pushSubscribeOp, userActor(member), {
    endpoint: `${origin}/push/${member.id}`,
    keys: {
      p256dh: webPush.generateVAPIDKeys().publicKey,
      auth: randomBytes(16).toString("base64url"),
    },
    userAgent: "Bun test",
  });
  await execute(ctx, threadsCreateOp, userActor(author), {
    nodeId: node.id,
    title: "Hello",
    body: `Welcome @${member.username}`,
  });
  await dispatchEvents(ctx);
  while (await runDueJobs(ctx)) await dispatchEvents(ctx);
  expect(received).toEqual([`/push/${member.id}`]);
});
