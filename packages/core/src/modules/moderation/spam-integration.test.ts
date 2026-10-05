import { expect, test } from "bun:test";
import { createTestContext, insertNode, insertUser, userActor } from "@sermo/core/testing";
import { invalidate } from "../../context";
import { execute } from "../../operation";
import { getAuth } from "../auth";
import { conversationsCreateOp } from "../conversations";
import { threadsCreateOp } from "../forums";

test("optional checker rejects registration using the trusted IP header", async () => {
  const ctx = createTestContext();
  const seen: string[] = [];
  ctx.config.spamChecker = {
    async check(submission) {
      seen.push(`${submission.kind}:${submission.ip}`);
      return { spam: true, source: "akismet" };
    },
  };
  const response = await getAuth(ctx).api.signUpEmail({
    body: {
      name: "Spammer",
      email: "spammer@example.test",
      password: "password123",
      username: "Spammer_1",
    },
    headers: new Headers({ "x-sermo-client-ip": "192.0.2.8" }),
    asResponse: true,
  });
  expect(response.status).toBe(400);
  expect(seen).toEqual(["signup:192.0.2.8"]);
  expect(
    ctx.sqlite.prepare("SELECT id FROM users WHERE username_key = 'spammer_1'").get(),
  ).toBeNull();
});

test("optional checker queues new forum and conversation content without publishing counts", async () => {
  const ctx = createTestContext();
  const node = insertNode(ctx, {});
  invalidate(ctx, "node_tree");
  const author = userActor(insertUser(ctx));
  const recipient = userActor(insertUser(ctx));
  if (author.kind === "guest" || recipient.kind === "guest") throw new Error("fixture");
  const actor = { ...author, clientIp: "192.0.2.9" };
  const seen: string[] = [];
  ctx.config.spamChecker = {
    async check(submission) {
      seen.push(`${submission.kind}:${submission.ip}`);
      return { spam: true, source: "stopforumspam" };
    },
  };
  const thread = await execute(ctx, threadsCreateOp, actor, {
    nodeId: node.id,
    title: "Held",
    body: "Message",
  });
  const conversation = await execute(ctx, conversationsCreateOp, actor, {
    title: "Held",
    recipientIds: [recipient.userId],
    body: "Message",
  });
  expect(thread.thread.state).toBe("moderated");
  expect(conversation.message.state).toBe("moderated");
  expect(conversation.conversation.messageCount).toBe(0);
  expect(
    ctx.sqlite
      .prepare<{ thread_count: number }, [number]>("SELECT thread_count FROM nodes WHERE id = ?1")
      .get(node.id)?.thread_count,
  ).toBe(0);
  expect(seen).toEqual(["forum-post:192.0.2.9", "message:192.0.2.9"]);
});
