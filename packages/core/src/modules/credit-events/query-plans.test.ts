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
      active: ["registered", ctx.now()],
      limit: [1, 1, ctx.now()],
      apply: [1, 1, "thread", 1, 0, 10, 1, ctx.now()],
      flip: ["reverted", 2, "thread", 1, "applied"],
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
