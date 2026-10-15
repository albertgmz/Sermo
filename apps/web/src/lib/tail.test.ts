import { beforeEach, expect, test } from "bun:test";
import { enterViewer } from "@/lib/session-epoch";
import {
  addPending,
  appendRows,
  dropForReload,
  EMPTY_TAIL,
  markTailShown,
  pollFound,
  pollFrom,
  readTail,
  sendIntoTail,
  settlePending,
  type TailRow,
  tailIsShown,
  updateTail,
  writeTail,
} from "@/lib/tail";

const row = (id: number): TailRow => ({
  key: `message-${id}`,
  id,
  mark: id,
  node: null,
});

beforeEach(() => writeTail("c:1", undefined));

test("rows arrive in the order of their marks and each key once", () => {
  const first = appendRows(EMPTY_TAIL, [row(12)]);
  const both = appendRows(first, [row(11), row(12), row(13)]);
  expect(both.rows.map((r) => r.id)).toEqual([11, 12, 13]);
});

test("an answer that brings nothing new gives back the same tail", () => {
  const tail = appendRows(EMPTY_TAIL, [row(5)]);
  expect(appendRows(tail, [row(5)])).toBe(tail);
  expect(appendRows(tail, [])).toBe(tail);
});

test("a waiting text goes when it is settled, and its row joins the tail", () => {
  const waiting = addPending(EMPTY_TAIL, { id: 1, text: "hello" });
  expect(waiting.pending).toEqual([{ id: 1, text: "hello" }]);
  const done = settlePending(waiting, 1, row(7));
  expect(done.pending).toEqual([]);
  expect(done.rows.map((r) => r.id)).toEqual([7]);
});

test("a refused text goes without a row", () => {
  const waiting = addPending(EMPTY_TAIL, { id: 1, text: "hello" });
  expect(settlePending(waiting, 1, undefined)).toEqual(EMPTY_TAIL);
});

test("the next poll starts after the newest row a poll returned, or what the page was drawn with", () => {
  const drawn = { id: 4, mark: 4 };
  expect(pollFrom(EMPTY_TAIL, drawn)).toEqual(drawn);
  const tail = pollFound(EMPTY_TAIL, [row(5), row(6)]);
  expect(pollFrom(tail, drawn)).toEqual({ id: 6, mark: 6 });
  // A page drawn newer than the poll starts after the page.
  expect(pollFrom(tail, { id: 9, mark: 9 })).toEqual({ id: 9, mark: 9 });
});

test("the visitor's own row does not move where the next poll starts", () => {
  const drawn = { id: 10, mark: 10 };
  const sent = settlePending(
    addPending(EMPTY_TAIL, { id: 1, text: "mine" }),
    1,
    row(12),
  );
  expect(sent.rows.map((r) => r.mark)).toEqual([12]);
  expect(pollFrom(sent, drawn)).toEqual(drawn);
});

test("a member's row that arrived just before the visitor's send is still fetched and shown in order", () => {
  const drawn = { id: 10, mark: 10 };
  // Another member wrote 11; the visitor, who has not received it, sent and the answer is 12.
  let tail = settlePending(
    addPending(EMPTY_TAIL, { id: 1, text: "mine" }),
    1,
    row(12),
  );
  // The next poll asks after 10, not after 12, and the server answers 11 and 12.
  const from = pollFrom(tail, drawn);
  expect(from.mark).toBe(10);
  tail = pollFound(tail, [row(11), row(12)]);
  expect(tail.rows.map((r) => r.id)).toEqual([11, 12]);
  expect(pollFrom(tail, drawn)).toEqual({ id: 12, mark: 12 });
});

test("a thread drawn again after a move drops the rows and where it polled from, not the texts being sent", () => {
  const tail = addPending(pollFound(EMPTY_TAIL, [row(11), row(12)]), {
    id: 1,
    text: "mine",
  });
  const after = dropForReload(tail);
  expect(after.rows).toEqual([]);
  expect(after.polled).toBeNull();
  expect(after.pending).toEqual([{ id: 1, text: "mine" }]);
  expect(pollFrom(after, { id: 5, mark: 5 })).toEqual({ id: 5, mark: 5 });
});

test("a poll that found nothing leaves where the next one starts", () => {
  const drawn = { id: 10, mark: 10 };
  const tail = pollFound(EMPTY_TAIL, []);
  expect(pollFrom(tail, drawn)).toEqual(drawn);
  const found = pollFound(tail, [row(11)]);
  expect(pollFound(found, [])).toBe(found);
});

test("a text shows as waiting before the server answers and is replaced by its row", async () => {
  writeTail("c:1", EMPTY_TAIL);
  let answer = (_: { row: TailRow }) => {};
  const sent = sendIntoTail(
    "c:1",
    "hello",
    () => new Promise((done) => (answer = done)),
  );
  expect(readTail("c:1")?.pending.map((p) => p.text)).toEqual(["hello"]);
  answer({ row: row(9) });
  expect(await sent).toBeUndefined();
  expect(readTail("c:1")?.pending).toEqual([]);
  expect(readTail("c:1")?.rows.map((r) => r.id)).toEqual([9]);
});

test("a refusal takes the waiting text away and is handed back", async () => {
  writeTail("c:1", EMPTY_TAIL);
  const error = await sendIntoTail("c:1", "hello", async () => ({
    error: "You may not reply.",
  }));
  expect(error).toBe("You may not reply.");
  expect(readTail("c:1")).toEqual(EMPTY_TAIL);
});

test("a call that fails takes the waiting text away and raises", async () => {
  writeTail("c:1", EMPTY_TAIL);
  await expect(
    sendIntoTail("c:1", "hello", async () => {
      throw new Error("network");
    }),
  ).rejects.toThrow("network");
  expect(readTail("c:1")).toEqual(EMPTY_TAIL);
});

test("a row the poll found first is not drawn twice when the answer arrives", async () => {
  writeTail("c:1", EMPTY_TAIL);
  let answer = (_: { row: TailRow }) => {};
  const sent = sendIntoTail(
    "c:1",
    "hello",
    () => new Promise((done) => (answer = done)),
  );
  writeTail("c:1", appendRows(readTail("c:1") ?? EMPTY_TAIL, [row(9)]));
  answer({ row: row(9) });
  await sent;
  expect(readTail("c:1")?.rows).toHaveLength(1);
});

test("text with nothing in it is not shown as waiting", async () => {
  writeTail("c:1", EMPTY_TAIL);
  let seen = -1;
  await sendIntoTail("c:1", "  \n", async () => {
    seen = readTail("c:1")?.pending.length ?? -1;
    return { error: "Write something." };
  });
  expect(seen).toBe(0);
});

test("a tail is shown only while something has registered it", () => {
  expect(tailIsShown("c:1")).toBe(false);
  const first = markTailShown("c:1");
  const second = markTailShown("c:1");
  expect(tailIsShown("c:1")).toBe(true);
  first();
  expect(tailIsShown("c:1")).toBe(true);
  second();
  expect(tailIsShown("c:1")).toBe(false);
});

test("what a tail holds stays when it goes off the screen, and a tail not yet written is empty", () => {
  const off = markTailShown("c:1");
  updateTail("c:1", (tail) => appendRows(tail, [row(3)]));
  off();
  expect(tailIsShown("c:1")).toBe(false);
  expect(readTail("c:1")?.rows.map((r) => r.id)).toEqual([3]);
});

test("what one visitor was reading is gone for the next, and an answer from before does not come back", async () => {
  enterViewer(20);
  writeTail("c:2", pollFound(EMPTY_TAIL, [row(5)]));
  let answer = (_: { row: TailRow }) => {};
  const sent = sendIntoTail(
    "c:2",
    "mine",
    () => new Promise((done) => (answer = done)),
  );
  enterViewer(21);
  expect(readTail("c:2")).toBeUndefined();
  answer({ row: row(9) });
  await sent;
  expect(readTail("c:2")).toBeUndefined();
  enterViewer(null);
});
