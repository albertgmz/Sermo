import { afterEach, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createTestContext, insertNode, insertUser, userActor } from "@sermo/core/testing";
import webPush from "web-push";
import { invalidate } from "../../context";
import { execute } from "../../operation";
import { threadsCreateOp } from "../forums";
import { runDueJobs } from "../jobs";
import { updateSiteSettings } from "../settings";
import { configurePush, pushSubscribeOp } from ".";
import { deliverPush, type PushItem, registerPushJobs } from "./delivery";

const cert = readFileSync(new URL("./fixtures/test-cert.pem", import.meta.url));
const key = readFileSync(new URL("./fixtures/test-key.pem", import.meta.url));
const contexts: ReturnType<typeof createTestContext>[] = [];
afterEach(() => {
  for (const ctx of contexts.splice(0)) ctx.sqlite.close(true);
});
const defaults = { thread_reply: { inApp: true, email: false, push: true } };

test("a push about a marked thread reaches only devices of members who may see it", async () => {
  const reached: string[] = [];
  const server = Bun.serve({
    port: 0,
    tls: { cert, key },
    fetch(request) {
      reached.push(new URL(request.url).pathname);
      return new Response(null, { status: 201 });
    },
  });
  try {
    const ctx = createTestContext();
    contexts.push(ctx);
    configurePush(ctx, {
      vapid: { ...webPush.generateVAPIDKeys(), subject: "mailto:test@example.test" },
      testAllowedEndpointOrigin: `https://localhost:${server.port}`,
      testCa: cert,
    });
    registerPushJobs(ctx, { renderPhrase: () => ({ title: "Reply", bodyHtml: "<p>Body</p>" }) });
    const admin = userActor(insertUser(ctx, { groupId: 4 }));
    const author = userActor(insertUser(ctx));
    const adult = insertUser(ctx);
    const minor = insertUser(ctx);
    ctx.sqlite
      .prepare(
        "UPDATE users SET birth_year = 1990, birthday_md = '01-01', adult_accepted_at = 1 WHERE id = ?1",
      )
      .run(adult.id);
    const node = insertNode(ctx, {});
    invalidate(ctx, "node_tree");
    updateSiteSettings(ctx, admin, { adultMode: true });
    for (const [user, path] of [
      [adult, "/adult"],
      [minor, "/minor"],
    ] as const)
      await execute(ctx, pushSubscribeOp, userActor(user), {
        endpoint: `https://localhost:${server.port}${path}`,
        keys: {
          p256dh: webPush.generateVAPIDKeys().publicKey,
          auth: randomBytes(16).toString("base64url"),
        },
        userAgent: "Bun test",
      });
    const made = await execute(ctx, threadsCreateOp, author, {
      nodeId: node.id,
      title: "Marked",
      body: "Body",
      isAdult: true,
    });
    const items: PushItem[] = [adult.id, minor.id].map((userId) => ({
      notificationId: ctx.sqlite
        .prepare<{ id: number }, [number, number, number]>(
          "INSERT INTO notifications (user_id,type,content_type,content_id,thread_id,created_at,updated_at) VALUES (?1,'thread_reply','thread',?2,?2,?3,?3) RETURNING id",
        )
        .get(userId, made.thread.id, ctx.now())!.id,
      userId,
      type: "thread_reply",
      contentType: "thread",
      contentId: made.thread.id,
      threadId: made.thread.id,
      actorId: null,
      data: {},
    }));
    deliverPush(ctx, items, defaults);
    await runDueJobs(ctx);
    expect(reached).toEqual(["/adult"]);
  } finally {
    server.stop(true);
  }
});
