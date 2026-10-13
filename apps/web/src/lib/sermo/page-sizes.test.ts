import assert from "node:assert/strict";
import { test } from "node:test";
import { seoThread } from "@sermo/core/contracts";
import { POSTS_PER_PAGE } from "./page-sizes";

test("the posts of a page are as many as the backend's SEO read counts for a page", () => {
  assert.equal(POSTS_PER_PAGE, seoThread.input.parse({ threadId: 1 }).pageSize);
  assert.ok(POSTS_PER_PAGE >= 1);
});
