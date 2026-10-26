import { afterEach, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createTestContext, insertNode, insertUser, userActor } from "@sermo/core/testing";
import webPush from "web-push";
import { invalidate } from "../../context";
import { execute } from "../../operation";
import { threadsCreateOp } from "../forums";
import { runDueJobs } from "../jobs";
import { usersBlockOp } from "../social";
import { configurePush, pushSubscribeOp } from ".";
import { deliverPush, type PushItem, registerPushJobs } from "./delivery";

const cert = readFileSync(new URL("./fixtures/test-cert.pem", import.meta.url));
const key = readFileSync(new URL("./fixtures/test-key.pem", import.meta.url));
const contexts: ReturnType<typeof createTestContext>[] = [];
afterEach(() => {
  for (const ctx of contexts.splice(0)) ctx.sqlite.close(true);
});
const defaults = {
  "thread.watched": { inApp: true, email: false, push: true },
  "moderation.content": { inApp: true, email: false, push: true },
};

test("a push across a block: official notices go, others do not, nor any from the other member", async () => {
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
    registerPushJobs(ctx, { renderPhrase: () => ({ title: "Notice", bodyHtml: "<p>Body</p>" }) });
    const author = insertUser(ctx);
    const blocker = insertUser(ctx);
    const third = insertUser(ctx);
    const node = insertNode(ctx, {});
    invalidate(ctx, "node_tree");
    await execute(ctx, pushSubscribeOp, userActor(blocker), {
      endpoint: `https://localhost:${server.port}/blocker`,
      keys: {
        p256dh: webPush.generateVAPIDKeys().publicKey,
        auth: randomBytes(16).toString("base64url"),
      },
      userAgent: "Bun test",
    });
    const made = await execute(ctx, threadsCreateOp, userActor(author), {
      nodeId: node.id,
      title: "Theirs",
      body: "Body",
    });
    await execute(ctx, usersBlockOp, userActor(blocker), { userId: author.id });
    const item = (type: string, actorId: number | null): PushItem => ({
      notificationId: ctx.sqlite
        .prepare<{ id: number }, [number, string, number, number]>(
          "INSERT INTO notifications (user_id,type,content_type,content_id,thread_id,created_at,updated_at) VALUES (?1,?2,'thread',?3,?3,?4,?4) RETURNING id",
        )
        .get(blocker.id, type, made.thread.id, ctx.now())!.id,
      userId: blocker.id,
      type,
      contentType: "thread",
      contentId: made.thread.id,
      threadId: made.thread.id,
      actorId,
      data: {},
    });
    // A notice about the other member's thread, and one whose actor is the other member.
    deliverPush(ctx, [item("thread.watched", third.id)], defaults);
    deliverPush(ctx, [item("thread.watched", author.id)], defaults);
    await runDueJobs(ctx);
    expect(reached).toEqual([]);
    // An official notice still arrives.
    deliverPush(ctx, [item("moderation.content", null)], defaults);
    await runDueJobs(ctx);
    expect(reached).toEqual(["/blocker"]);
  } finally {
    server.stop(true);
  }
});
