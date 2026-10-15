import { beforeEach, expect, test } from "bun:test";
import { changeItem, itemChanges, shownValue } from "@/lib/item-state";

beforeEach(() => itemChanges.clear());

test("a change shows while the server's value is the one it was made on", () => {
  expect(shownValue(undefined, false)).toBe(false);
  expect(shownValue({ drawn: false, value: true }, false)).toBe(true);
});

test("once the server draws something else its value is shown", () => {
  expect(shownValue({ drawn: false, value: true }, true)).toBe(true);
  expect(shownValue({ drawn: 1, value: 2 }, 3)).toBe(3);
  expect(shownValue({ drawn: null, value: 5 }, 7)).toBe(7);
});

test("the new value is shown before the server has answered", async () => {
  let release = () => {};
  const asked = changeItem(
    "bookmark:post:1",
    false,
    true,
    () => new Promise((done) => (release = () => done({}))),
  );
  expect(itemChanges.get("bookmark:post:1")).toEqual({
    drawn: false,
    value: true,
  });
  release();
  expect(await asked).toBeUndefined();
  expect(itemChanges.get("bookmark:post:1")).toEqual({
    drawn: false,
    value: true,
  });
});

test("a refusal puts back what was shown and says why", async () => {
  const error = await changeItem("follow:3", false, true, async () => ({
    error: "You may not follow members.",
  }));
  expect(error).toBe("You may not follow members.");
  expect(shownValue(itemChanges.get("follow:3") as never, false)).toBe(false);
});

test("a refusal after an earlier change goes back to that change", async () => {
  await changeItem("reaction:post:9", null, 2, async () => ({}));
  const error = await changeItem("reaction:post:9", null, 3, async () => ({
    error: "no",
  }));
  expect(error).toBe("no");
  expect(shownValue(itemChanges.get("reaction:post:9") as never, null)).toBe(2);
});

test("a call that fails puts the old value back without a message", async () => {
  const error = await changeItem("follow:4", false, true, async () => {
    throw new Error("network");
  });
  expect(error).toBeUndefined();
  expect(shownValue(itemChanges.get("follow:4") as never, false)).toBe(false);
});

test("items are kept apart by key", async () => {
  await changeItem("bookmark:post:1", false, true, async () => ({}));
  expect(itemChanges.get("bookmark:post:2")).toBeUndefined();
  expect(itemChanges.get("bookmark:thread:1")).toBeUndefined();
});
