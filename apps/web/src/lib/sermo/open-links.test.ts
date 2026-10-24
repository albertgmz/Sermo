import assert from "node:assert/strict";
import { test } from "node:test";
import { conversationOpenHref, threadOpenHref } from "./open-links";

test("a member's link to a thread opens where they left off and a guest's opens the start", () => {
  assert.equal(threadOpenHref(7, true), "/threads/7/unread");
  assert.equal(threadOpenHref(7, false), "/threads/7");
});

test("a link to a conversation opens where the member left off", () => {
  assert.equal(conversationOpenHref(5), "/conversations/5/unread");
});
