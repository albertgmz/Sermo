import { afterEach, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createTestContext, insertUser, userActor } from "@sermo/core/testing";
import webPush from "web-push";
import { execute } from "../../operation";
import { getOperation } from "../../operations";
import { registerEmailJobs } from "../email";
import { runDueJobs } from "../jobs/queue";
import {
  notificationChannels,
  notificationPushPhrase,
  notificationsSetPreferencesOp,
  registerNotificationJobs,
} from "../notifications";
import { configurePush, pushSubscribeOp, registerPushJobs } from "../push";
import type { PushPhrase } from "../push/delivery";
import { registerBroadcastJobs } from "./index";

const cert = readFileSync(new URL("../push/fixtures/test-cert.pem", import.meta.url));
const key = readFileSync(new URL("../push/fixtures/test-key.pem", import.meta.url));
const cleanup: Array<() => void> = [];
afterEach(() => {
  for (const close of cleanup.splice(0)) close();
});

test("an alert pushes to devices by default, honours a push opt-out and e-mails only who opted in", async () => {
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
  registerBroadcastJobs(ctx);
  const capture = registerEmailJobs(
    ctx,
    { driver: "capture", sender: "forum@example.test" },
    notificationChannels,
  )!;
  configurePush(ctx, {
    vapid: { ...webPush.generateVAPIDKeys(), subject: "mailto:test@example.test" },
    testAllowedEndpointOrigin: origin,
    testCa: cert,
  });
  const phrases: PushPhrase[] = [];
  const render = notificationPushPhrase(ctx);
  registerPushJobs(ctx, {
    renderPhrase: (item, language) => {
      const result = render(item, language);
      phrases.push(result);
      return result;
    },
  });
  const admin = insertUser(ctx, { groupId: 4 });
  const member = async (preferences: { push?: boolean; email?: boolean }) => {
    const user = insertUser(ctx);
    const actor = userActor(user);
    await execute(ctx, pushSubscribeOp, actor, {
      endpoint: `${origin}/push/${user.id}`,
      keys: {
        p256dh: webPush.generateVAPIDKeys().publicKey,
        auth: randomBytes(16).toString("base64url"),
      },
      userAgent: "Bun test",
    });
    if (Object.keys(preferences).length)
      await execute(ctx, notificationsSetPreferencesOp, actor, {
        items: [{ type: "admin.alert", ...preferences }],
      });
    return user;
  };
  const plain = await member({});
  const noPush = await member({ push: false });
  const mails = await member({ email: true });

  await execute(ctx, getOperation("broadcasts.start"), userActor(admin), {
    content: { kind: "alert", text: "Maintenance tonight at 22:00", url: "/pages/maintenance" },
    rule: { match: "all", conditions: [] },
  });
  while (await runDueJobs(ctx)) {}

  expect(received.sort()).toEqual([`/push/${plain.id}`, `/push/${mails.id}`].sort());
  expect(noPush.id).not.toBe(plain.id);
  expect(phrases[0]!.bodyHtml).toBe("Maintenance tonight at 22:00");
  expect(capture.messages.map((message) => message.to)).toHaveLength(1);
  expect(capture.messages[0]!.text).toContain("Maintenance tonight at 22:00");
});
