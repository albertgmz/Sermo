import { expect, test } from "bun:test";
import { createTestContext, expectNoTableScan } from "../../testing";
import { queries } from "./storage";

test("every credit rule query uses indexed lookups or the allowed small rule table", () => {
  const ctx = createTestContext();
  try {
    const params: Record<keyof typeof queries, unknown[]> = {
      list: [],
      rule: [1],
      forums: ["[1,2]"],
      create: ["Rule", "registered", 10, 1, null, null, "[]", ctx.now()],
      update: ["Rule", 10, 1, 2, 24, "[]", ctx.now(), 1],
      delete: [1],
      active: ["registered", 1],
      limit: [1, 1, ctx.now() - 3_600_000, ctx.now()],
      apply: [1, 1, "thread", 1, 0, 10, 1, ctx.now()],
      flip: ["reverted", 2, "thread", 1, "applied", 0, 500],
      sourceApplied: ["post", 1, 1, 2],
      firstVisibilityChange: ["thread", 1, 0],
      thread: [1],
      post: [1],
      profile_post: [1],
      profile_post_comment: [1],
      conversation_message: [1],
      award: [1],
    };
    expect(Object.keys(params).sort()).toEqual(Object.keys(queries).sort());
    for (const key of Object.keys(queries) as (keyof typeof queries)[])
      expectNoTableScan(ctx, queries[key], params[key]);
  } finally {
    ctx.sqlite.close(true);
  }
});

test("the paid-source lookup is answered by the source index alone", () => {
  const ctx = createTestContext();
  try {
    const plan = ctx.sqlite
      .prepare<{ detail: string }, [string, number, number, number]>(
        `EXPLAIN QUERY PLAN ${queries.sourceApplied}`,
      )
      .all("post", 1, 1, 2)
      .map((row) => row.detail)
      .join("\n");
    expect(plan).toContain(
      "credit_rule_applications_paid (source_type=? AND source_id=? AND rule_id=? AND source_user_id=?)",
    );
  } finally {
    ctx.sqlite.close(true);
  }
});
