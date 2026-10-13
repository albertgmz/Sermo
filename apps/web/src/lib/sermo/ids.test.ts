import assert from "node:assert/strict";
import { test } from "node:test";
import { parseId, parsePageId } from "./ids";

test("a page address is a plain id with an optional decoration after a dash", () => {
  assert.equal(parsePageId("12"), 12);
  assert.equal(parsePageId("12-hello"), 12);
  assert.equal(parsePageId("12-"), 12);
  assert.equal(parsePageId("12-hello-world-3"), 12);
  assert.equal(parsePageId("12-caf%C3%A9"), 12);
  assert.equal(parsePageId("12-café"), 12);
});

test("a page address that is not a plain id followed by a dash is no page", () => {
  for (const raw of [
    "",
    "0",
    "0-x",
    "012",
    "0x10",
    "0x10-x",
    "1e2",
    "1e2-x",
    "12abc",
    "12.5",
    "+12",
    " 12",
    "-12",
    "hello-12",
    "12-a/b",
    "99999999999999999999",
    "99999999999999999999-x",
  ]) {
    assert.equal(parsePageId(raw), null, raw);
  }
});

test("the strict parser still refuses the suffix", () => {
  assert.equal(parseId("12-hello"), null);
  assert.equal(parseId("12"), 12);
});
