import { expect, test } from "bun:test";
import { isNewPost, NEW_FOR_MS } from "./new-posts";

const now = Date.parse("2026-10-21T12:00:00.000Z");
const recent = new Date(now - 3_600_000).toISOString();
const post = (position: number, createdAt = recent) => ({
  position,
  createdAt,
});
const member = (readPosition: number | null) => ({
  signedIn: true,
  readPosition,
});

test("posts after the viewer's read position are new, the read ones are not", () => {
  expect(isNewPost(post(4), member(3), now)).toBe(true);
  expect(isNewPost(post(3), member(3), now)).toBe(false);
  expect(isNewPost(post(0), member(3), now)).toBe(false);
});

test("in a thread the viewer never opened every post is new, the opening one too", () => {
  for (const position of [0, 1, 25])
    expect(isNewPost(post(position), member(null), now)).toBe(true);
});

test("a guest never sees the badge", () => {
  expect(isNewPost(post(0), { signedIn: false, readPosition: null }, now)).toBe(
    false,
  );
});

test("a post older than the read-marking window counts as read, as the thread list does", () => {
  const old = new Date(now - NEW_FOR_MS - 1).toISOString();
  expect(isNewPost(post(5, old), member(null), now)).toBe(false);
  expect(isNewPost(post(5, old), member(2), now)).toBe(false);
  const inside = new Date(now - NEW_FOR_MS + 60_000).toISOString();
  expect(isNewPost(post(5, inside), member(2), now)).toBe(true);
});
