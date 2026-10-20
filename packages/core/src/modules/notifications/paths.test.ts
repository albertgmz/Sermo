import { expect, test } from "bun:test";
import { contentPath } from "./paths";

test("an alert links content by its own address, which needs no page", () => {
  expect(contentPath("post", 5, 2)).toBe("/posts/5");
  expect(contentPath("profile_post", 6, null)).toBe("/profile-posts/6");
  expect(contentPath("profile_post_comment", 7, null)).toBe("/profile-comments/7");
  expect(contentPath("conversation_message", 8, null)).toBe("/conversations/messages/8");
  expect(contentPath("conversation", 9, null)).toBe("/conversations/9");
  expect(contentPath("thread", 2, 2)).toBe("/threads/2");
  expect(contentPath("user", 3, null)).toBeNull();
});
