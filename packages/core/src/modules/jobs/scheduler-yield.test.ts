import { expect, test } from "bun:test";
import { createTestContext, insertNode, insertUser, userActor } from "@sermo/core/testing";
import { execute } from "../../operation";
import { threadsCreateOp } from "../forums";
import { runHourlyTasks } from "./scheduler";

test("hourly maintenance yields to the event loop between full batches", async () => {
  const ctx = createTestContext();
  const author = insertUser(ctx);
  const forum = insertNode(ctx, {});
  const made = await execute(ctx, threadsCreateOp, userActor(author), {
    nodeId: forum.id,
    title: "Busy",
    body: "body",
  });
  ctx.sqlite.prepare("DELETE FROM thread_reads").run();
  const insertRead = ctx.sqlite.prepare(
    "INSERT INTO thread_reads (user_id, thread_id, last_read_post_id, last_read_position, read_at) VALUES (?1, ?2, ?3, 0, ?4)",
  );
  for (let i = 0; i < 2500; i++)
    insertRead.run(insertUser(ctx).id, made.thread.id, made.post.id, ctx.now());

  let ticks = 0;
  let running = true;
  const tick = () => {
    ticks++;
    if (running) setImmediate(tick);
  };
  setImmediate(tick);
  await runHourlyTasks(ctx);
  running = false;

  // 2500 markers are three batches, so the loop yielded after each of the two full ones.
  expect(ticks).toBeGreaterThanOrEqual(2);
  expect(
    ctx.sqlite.prepare<{ n: number }, []>("SELECT COUNT(*) AS n FROM thread_reads").get()?.n,
  ).toBe(2500);
});
