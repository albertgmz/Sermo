import assert from "node:assert/strict";
import { test } from "node:test";
import { safeReturnPath } from "./return-path";

test("only a same-site path is followed", () => {
  for (const bad of [
    "//evil",
    `/${String.fromCharCode(92)}evil`,
    "https://x",
    "evil",
    "/login",
    "/login?next=/",
    "/register",
    `/a${String.fromCharCode(92)}b`,
    "/\nx",
    "/.//evil.com",
    "/./",
    "/a/../b",
    "/%2e//evil.com",
    "/a/%2E%2e/b",
    undefined,
    42,
  ]) {
    assert.equal(safeReturnPath(bad), "/", String(bad));
  }
  assert.equal(safeReturnPath("/threads/1?page=2"), "/threads/1?page=2");
  assert.equal(safeReturnPath("/account#top"), "/account#top");
  assert.equal(safeReturnPath("/login-help"), "/login-help");
});
