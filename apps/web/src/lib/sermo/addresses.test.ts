import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BACKEND_FORUM_PREFIX,
  canonicalPathOf,
  canonicalUrlOf,
  FORUM_PREFIX,
  toBackendPath,
} from "./addresses";

test("an address of this app is asked of the backend under its own name for forums", () => {
  assert.equal(
    toBackendPath(`/${FORUM_PREFIX}/3-general`),
    `/${BACKEND_FORUM_PREFIX}/3-general`,
  );
  assert.equal(toBackendPath("/threads/3-x"), "/threads/3-x");
  assert.equal(toBackendPath("/forumsx/3"), "/forumsx/3");
});

test("a canonical address from the backend is served by its path, under this app's names", () => {
  assert.equal(
    canonicalPathOf(`http://api.example/${BACKEND_FORUM_PREFIX}/3-a`),
    `/${FORUM_PREFIX}/3-a`,
  );
  assert.equal(
    canonicalPathOf("http://api.example/threads/9-b?page=2"),
    "/threads/9-b?page=2",
  );
  assert.equal(
    canonicalUrlOf(`http://api.example/${BACKEND_FORUM_PREFIX}/3-a`),
    `http://api.example/${FORUM_PREFIX}/3-a`,
  );
});
