import { beforeEach, expect, test } from "bun:test";
import {
  changeItem,
  type ItemChange,
  itemChanges,
  setItemState,
  shownValue,
} from "@/lib/item-state";
import { announceViewerChange, enterViewer } from "@/lib/session-epoch";

beforeEach(() => itemChanges.clear());

const FAILED = "Something went wrong.";
const taken = async () => ({});
const change = <T>(
  drawn: T,
  value: T,
  settledAt: number | null,
): ItemChange<T> => ({ drawn, value, settledAt });
const shownFor = <T>(key: string, drawn: T, delivered = 0) =>
  shownValue(
    itemChanges.get(key) as ItemChange<T> | undefined,
    drawn,
    delivered,
  );

test("a change shows while the server's value is the one it was made on", () => {
  expect(shownValue(undefined, false)).toBe(false);
  expect(shownValue(change(false, true, null), false)).toBe(true);
  expect(shownValue(change(false, true, 5), false, 3)).toBe(true);
});

test("once the server draws something else its value is shown", () => {
  expect(shownValue(change(false, true, 5), true, 3)).toBe(true);
  expect(shownValue(change(1, 2, 5), 3, 3)).toBe(3);
  expect(shownValue(change(null, 5, 5), 7, 3)).toBe(7);
});

test("markup drawn after the server answered is the truth, even when it reads as before", () => {
  // 0 unread drawn, a poll finds 3 (answered at 5), then "Mark all read" draws the header again
  // with 0: markup that reached the browser at 9.
  expect(shownValue(change(0, 3, 5), 0, 3)).toBe(3);
  expect(shownValue(change(0, 3, 5), 0, 9)).toBe(0);
  // A change from another device and back: A, B, A.
  expect(shownValue(change(false, true, 5), false, 9)).toBe(false);
});

test("a change still waiting for its answer shows on any markup that reads as before", () => {
  expect(shownValue(change(false, true, null), false, 99)).toBe(true);
});

test("the new value is shown before the server has answered, and stays after", async () => {
  let release = () => {};
  const asked = changeItem(
    "bookmark:post:1",
    false,
    true,
    () => new Promise((done) => (release = () => done({}))),
    FAILED,
  );
  expect(shownFor("bookmark:post:1", false)).toBe(true);
  release();
  expect(await asked).toEqual({});
  expect(shownFor("bookmark:post:1", false)).toBe(true);
});

test("a refusal puts back what was shown and says why", async () => {
  const result = await changeItem(
    "follow:3",
    false,
    true,
    async () => ({ error: "You may not follow members." }),
    FAILED,
  );
  expect(result).toEqual({
    error: "You may not follow members.",
    signIn: undefined,
  });
  expect(shownFor("follow:3", false)).toBe(false);
});

test("a refusal after an earlier change goes back to that change", async () => {
  await changeItem("reaction:post:9", null, 2, taken, FAILED);
  const result = await changeItem(
    "reaction:post:9",
    null,
    3,
    async () => ({ error: "no" }),
    FAILED,
  );
  expect(result.error).toBe("no");
  expect(shownFor("reaction:post:9", null)).toBe(2);
});

test("a call that fails puts the old value back and says so", async () => {
  const result = await changeItem(
    "follow:4",
    false,
    true,
    async () => {
      throw new Error("network");
    },
    FAILED,
  );
  expect(result).toEqual({ error: FAILED });
  expect(shownFor("follow:4", false)).toBe(false);
});

test("a session that has ended puts the change back and says where to sign in", async () => {
  const result = await changeItem(
    "reaction:post:5",
    null,
    1,
    async () => ({ error: "Sign in.", signIn: "/login?next=%2Fthreads%2F5" }),
    FAILED,
  );
  expect(result.signIn).toBe("/login?next=%2Fthreads%2F5");
  expect(shownFor("reaction:post:5", null)).toBeNull();
});

test("an older refusal never overwrites a newer change", async () => {
  let refuse = (_: { error: string }) => {};
  const first = changeItem(
    "reaction:post:7",
    null,
    1,
    () => new Promise((done) => (refuse = done)),
    FAILED,
  );
  // The member clicks again before the first answer: another reaction.
  const second = changeItem("reaction:post:7", null, 2, taken, FAILED);
  refuse({ error: "refused" });
  expect((await first).error).toBe("refused");
  await second;
  // The newer change stands, and nothing of the refused first one is put in its place.
  expect(shownFor("reaction:post:7", null)).toBe(2);
});

test("a refused change is not brought back by the refusal of the one after it", async () => {
  let refuse = (_: { error: string }) => {};
  const first = changeItem(
    "reaction:post:8",
    null,
    1,
    () => new Promise((done) => (refuse = done)),
    FAILED,
  );
  const second = changeItem(
    "reaction:post:8",
    null,
    2,
    async () => ({ error: "also refused" }),
    FAILED,
  );
  await second;
  refuse({ error: "refused" });
  await first;
  expect(shownFor("reaction:post:8", null)).toBeNull();
});

test("items are kept apart by key", async () => {
  await changeItem("bookmark:post:1", false, true, taken, FAILED);
  expect(itemChanges.get("bookmark:post:2")).toBeUndefined();
  expect(itemChanges.get("bookmark:thread:1")).toBeUndefined();
});

test("a value a poll found shows until the server draws again", () => {
  setItemState("counter:notifications", 0, 4);
  expect(shownFor("counter:notifications", 0, 0)).toBe(4);
  // The alerts were marked read and the header drawn again: 0, drawn after the poll.
  expect(shownFor("counter:notifications", 0, Number.MAX_SAFE_INTEGER)).toBe(0);
});

test("what one member changed is never shown to the next one on the tab", async () => {
  enterViewer(1);
  await changeItem("bookmark:thread:5", false, true, taken, FAILED);
  setItemState("counter:conversations", 0, 3);
  expect(shownFor("bookmark:thread:5", false)).toBe(true);
  // Member 2 signs in on the same tab.
  enterViewer(2);
  announceViewerChange();
  expect(shownFor("bookmark:thread:5", false)).toBe(false);
  expect(shownFor("counter:conversations", 0)).toBe(0);
  expect(itemChanges.get("bookmark:thread:5")).toBeUndefined();
  enterViewer(null);
});

test("an answer that comes after the visitor changed writes nothing for the next one", async () => {
  enterViewer(10);
  let answer = (_: object) => {};
  const asked = changeItem(
    "follow:9",
    false,
    true,
    () => new Promise((done) => (answer = done)),
    FAILED,
  );
  enterViewer(11);
  answer({});
  await asked;
  expect(itemChanges.get("follow:9")).toBeUndefined();
  enterViewer(null);
});
