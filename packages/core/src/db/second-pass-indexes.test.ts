import { expect, test } from "bun:test";
import { createTestContext, expectNoTableScan } from "@sermo/core/testing";

test("approval and author cleanup queries use covering filter and sort indexes", () => {
  const ctx = createTestContext();
  for (const table of [
    "threads",
    "posts",
    "profile_posts",
    "profile_post_comments",
    "conversation_messages",
  ]) {
    expectNoTableScan(
      ctx,
      `SELECT id FROM ${table} WHERE state = 'moderated' AND id < ?1 ORDER BY id DESC LIMIT ?2`,
      [1000, 50],
    );
    expectNoTableScan(
      ctx,
      `SELECT id FROM ${table} WHERE user_id = ?1 AND id < ?2 ORDER BY id DESC LIMIT ?3`,
      [1, 1000, 50],
    );
  }
  expect(ctx.sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);
  ctx.sqlite.close(true);
});
