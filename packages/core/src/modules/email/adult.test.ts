import { expect, test } from "bun:test";
import { createTestContext, insertNode, insertUser, userActor } from "@sermo/core/testing";
import { invalidate } from "../../context";
import { runDueJobs } from "../jobs/queue";
import { updateSiteSettings } from "../settings";
import { registerEmailJobs, runWeeklyDigest } from "./index";
import { visibleTo } from "./visibility";

const registry = {
  defaults: { "digest.weekly": { inApp: false, email: true, push: false } },
  securityTypes: new Set<string>(),
};

/** A marked thread, an adult and a minor who were away five days, and the +18 mode on. */
function setup() {
  const ctx = createTestContext();
  const admin = userActor(insertUser(ctx, { groupId: 4 }));
  const author = insertUser(ctx, { username: "Author" });
  const adult = insertUser(ctx, { username: "Adult" });
  const minor = insertUser(ctx, { username: "Minor" });
  const node = insertNode(ctx, {});
  invalidate(ctx, "node_tree");
  const threadId = ctx.sqlite
    .prepare<{ id: number }, [number, number, number]>(
      "INSERT INTO threads (node_id, user_id, title, created_at, last_post_at, last_poster_id, is_adult) VALUES (?1, ?2, 'Marked', ?3, ?3, ?2, 1) RETURNING id",
    )
    .get(node.id, author.id, ctx.now())!.id;
  const facts = ctx.sqlite.prepare(
    "UPDATE users SET birth_year = ?2, birthday_md = '01-01', adult_accepted_at = 1, last_activity_at = ?3 WHERE id = ?1",
  );
  facts.run(adult.id, 1990, ctx.now() - 5 * 86_400_000);
  facts.run(minor.id, 2012, ctx.now() - 5 * 86_400_000);
  updateSiteSettings(ctx, admin, { adultMode: true });
  const emailOf = (id: number) =>
    ctx.sqlite
      .prepare<{ email: string }, [number]>("SELECT email FROM auth_user WHERE id = ?1")
      .get(id)!.email;
  return { ctx, adult, minor, threadId, emailOf };
}

test("a notification email about a marked thread is for those who may see it", () => {
  const { ctx, adult, minor, threadId } = setup();
  expect(visibleTo(ctx, userActor(adult), "thread", threadId, threadId)).toBe(true);
  expect(visibleTo(ctx, userActor(minor), "thread", threadId, threadId)).toBe(false);
});

test("the weekly digest leaves a marked thread out for a member who may not see it", async () => {
  const { ctx, adult, minor, emailOf } = setup();
  const capture = registerEmailJobs(
    ctx,
    { driver: "capture", sender: "f@example.test" },
    registry,
  )!;
  await runWeeklyDigest(ctx, registry);
  await runDueJobs(ctx);
  const to = capture.messages.map((message) => message.to);
  expect(to).toContain(emailOf(adult.id));
  expect(to).not.toContain(emailOf(minor.id));
});
