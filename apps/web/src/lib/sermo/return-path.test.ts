import assert from "node:assert/strict";
import { test } from "node:test";
import { chooseUsernamePath, safeReturnPath } from "./return-path";

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

test("the username screen is never a page to return to", () => {
  assert.equal(safeReturnPath("/choose-username"), "/");
  assert.equal(safeReturnPath("/choose-username?next=/threads/1"), "/");
});

test("the username screen's address carries the page to return to, only when it is same-site", () => {
  assert.equal(
    chooseUsernamePath("/threads/1?page=2"),
    "/choose-username?next=%2Fthreads%2F1%3Fpage%3D2",
  );
  assert.equal(chooseUsernamePath("/"), "/choose-username");
  assert.equal(chooseUsernamePath("//evil.example"), "/choose-username");
  assert.equal(chooseUsernamePath("https://evil.example/"), "/choose-username");
  assert.equal(chooseUsernamePath(null), "/choose-username");
});
