import { expect, test } from "bun:test";
import { createTestContext, insertNode, insertUser, userActor } from "@sermo/core/testing";
import { invalidate } from "../../context";
import { execute } from "../../operation";
import { runDueJobs } from "../jobs/queue";
import { usersBlockOp } from "../social";
import { registerEmailJobs, runWeeklyDigest } from "./index";
import { visibleTo } from "./visibility";

const registry = {
  defaults: { "digest.weekly": { inApp: false, email: true, push: false } },
  securityTypes: new Set<string>(),
};

/** A thread by one member and two readers who were away five days. */
function setup() {
  const ctx = createTestContext();
  const author = insertUser(ctx, { username: "Author" });
  const reader = insertUser(ctx, { username: "Reader" });
  const blocker = insertUser(ctx, { username: "Blocker" });
  const node = insertNode(ctx, {});
  invalidate(ctx, "node_tree");
  const threadId = ctx.sqlite
    .prepare<{ id: number }, [number, number, number]>(
      "INSERT INTO threads (node_id, user_id, title, created_at, last_post_at, last_poster_id) VALUES (?1, ?2, 'Fresh', ?3, ?3, ?2) RETURNING id",
    )
    .get(node.id, author.id, ctx.now())!.id;
  const away = ctx.sqlite.prepare("UPDATE users SET last_activity_at = ?2 WHERE id = ?1");
  for (const user of [reader, blocker]) away.run(user.id, ctx.now() - 5 * 86_400_000);
  const emailOf = (id: number) =>
    ctx.sqlite
      .prepare<{ email: string }, [number]>("SELECT email FROM auth_user WHERE id = ?1")
      .get(id)!.email;
  return { ctx, author, reader, blocker, threadId, emailOf };
}

test("a notice e-mail about a thread of a member in a block with the recipient is not sent", async () => {
  const { ctx, author, blocker, reader, threadId } = setup();
  await execute(ctx, usersBlockOp, userActor(blocker), { userId: author.id });
  expect(visibleTo(ctx, userActor(blocker), "thread", threadId, threadId)).toBe(false);
  expect(visibleTo(ctx, userActor(reader), "thread", threadId, threadId)).toBe(true);
});

test("the weekly digest leaves out the threads of a member in a block with the recipient", async () => {
  const { ctx, author, blocker, reader, emailOf } = setup();
  await execute(ctx, usersBlockOp, userActor(blocker), { userId: author.id });
  const capture = registerEmailJobs(
    ctx,
    { driver: "capture", sender: "f@example.test" },
    registry,
  )!;
  await runWeeklyDigest(ctx, registry);
  await runDueJobs(ctx);
  const to = capture.messages.map((message) => message.to);
  expect(to).toContain(emailOf(reader.id));
  expect(to).not.toContain(emailOf(blocker.id));
});
