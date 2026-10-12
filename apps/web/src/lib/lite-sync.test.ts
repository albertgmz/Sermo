import assert from "node:assert/strict";
import { test } from "node:test";
import {
  commitLiteValue,
  getCommittedLiteValue,
  liteReloadKey,
  subscribeLiteValue,
} from "./lite-sync";

test("equivalent encoded, legacy, reordered and duplicate cookies do not reload", () => {
  for (const [rendered, cookie] of [
    ["all", "forum_lite=%61ll"],
    ["%61ll", "forum_lite=all"],
    ["all", "forum_lite=1"],
    ["avatars.frames", "forum_lite=frames%2Eavatars"],
    ["all", "forum_lite=frames; forum_lite=all"],
  ])
    assert.equal(liteReloadKey(rendered, cookie, new Set()), null);
});

test("a mismatched pair reloads at most once, even after other pairs", () => {
  const attempted = new Set<string>();
  const first = liteReloadKey("frames", "forum_lite=all", attempted);
  assert.ok(first);
  attempted.add(first);
  const second = liteReloadKey("frames", "forum_lite=avatars", attempted);
  assert.ok(second);
  attempted.add(second);
  assert.equal(liteReloadKey("frames", "forum_lite=%61ll", attempted), null);
});

test("a committed preference change invalidates member card subscribers", () => {
  commitLiteValue("");
  let changes = 0;
  const unsubscribe = subscribeLiteValue(() => changes++);
  commitLiteValue("frames");
  assert.equal(getCommittedLiteValue(), "frames");
  assert.equal(changes, 1);
  commitLiteValue("%66rames");
  assert.equal(changes, 1);
  commitLiteValue("all.frames");
  assert.equal(changes, 2);
  unsubscribe();
  commitLiteValue("");
  assert.equal(changes, 2);
});
