import type { ReactNode } from "react";
import { createKeyedStore } from "@/lib/keyed-store";
import { currentEpoch, registerStore } from "@/lib/session-epoch";

// The end of a conversation or of the last page of a thread, as it grows while the visitor reads:
// rows drawn on the server that arrived after the page was drawn (found by a poll, or the
// visitor's own, answered by the server), and the texts the visitor has sent that the server has
// not answered yet. `mark` is what a poll asks "after" (a message id, a post position) and `id` is
// the row's own record.
//
// Where the next poll starts (`polled`) is apart from the rows: it moves only with what a poll
// returned, never with the visitor's own row. Their answer can sit past rows nobody has fetched
// (another member wrote in between), and a poll that started after it would skip them.
export type TailRow = {
  key: string;
  id: number;
  mark: number;
  node: ReactNode;
};
export type Tail = {
  rows: TailRow[];
  pending: { id: number; text: string }[];
  polled: { id: number; mark: number } | null;
};

export const EMPTY_TAIL: Tail = { rows: [], pending: [], polled: null };

// Rows in the order of their marks, each key once (the first one held wins: a row seen twice, by a
// poll and by the answer to its author's own send, is the same row).
export function appendRows(tail: Tail, incoming: TailRow[]): Tail {
  const held = new Set(tail.rows.map((row) => row.key));
  const fresh = incoming.filter((row) => {
    if (held.has(row.key)) return false;
    held.add(row.key);
    return true;
  });
  if (fresh.length === 0) return tail;
  return {
    ...tail,
    rows: [...tail.rows, ...fresh].toSorted((a, b) => a.mark - b.mark),
  };
}

export function addPending(tail: Tail, pending: { id: number; text: string }) {
  return { ...tail, pending: [...tail.pending, pending] };
}

// The text the server answered (or refused) stops waiting; its row, when it answered with one,
// joins the tail.
export function settlePending(
  tail: Tail,
  id: number,
  row: TailRow | undefined,
): Tail {
  const rest = { ...tail, pending: tail.pending.filter((p) => p.id !== id) };
  return row ? appendRows(rest, [row]) : rest;
}

// What a poll returned joins the tail, and the next poll starts after the newest of it.
export function pollFound(tail: Tail, rows: TailRow[]): Tail {
  const last = rows.reduce<TailRow | undefined>(
    (newest, row) => (!newest || row.mark > newest.mark ? row : newest),
    undefined,
  );
  const joined = appendRows(tail, rows);
  if (!last || (tail.polled && tail.polled.mark >= last.mark)) return joined;
  return { ...joined, polled: { id: last.id, mark: last.mark } };
}

// The thread changed under the tail (posts were moved or merged): what the tail held and where it
// polled from no longer describes the thread, which is drawn again. Texts being sent stay.
export function dropForReload(tail: Tail): Tail {
  return { ...tail, rows: [], polled: null };
}

// Where the next poll starts: after the newest row a poll returned, or what the page was drawn
// with when that is newer.
export function pollFrom(
  tail: Tail,
  drawn: { id: number; mark: number },
): { id: number; mark: number } {
  return tail.polled && tail.polled.mark > drawn.mark ? tail.polled : drawn;
}

const tails = createKeyedStore<Tail>();
registerStore(tails);

// What the tails hold outlives the component that shows them: a list that is hidden for a moment
// (a boundary above it waits for something) is shown again with its rows, and only the page
// drawn newer than a row takes it away (`LiveTail`).
export const useTail = (key: string) => tails.use(key);
export const readTail = (key: string) => tails.get(key);
export const writeTail = (key: string, tail: Tail | undefined) =>
  tails.set(key, tail);
export function updateTail(key: string, change: (tail: Tail) => Tail) {
  tails.set(key, change(tails.get(key) ?? EMPTY_TAIL));
}

// Which tails are on the screen now: a form that finds none under its key sends the old way, with
// a redirect, to a page that has it. A tail says so while it is shown, and takes it back when it
// is not.
const shown = new Map<string, number>();
export function markTailShown(key: string) {
  shown.set(key, (shown.get(key) ?? 0) + 1);
  return () => {
    const left = (shown.get(key) ?? 1) - 1;
    if (left > 0) shown.set(key, left);
    else shown.delete(key);
  };
}
export const tailIsShown = (key: string) => (shown.get(key) ?? 0) > 0;

let nextPending = 1;

// Shows `text` at the end of the tail at once and asks the server to send it. The server answers
// with the drawn row, which takes the place of the waiting text, or with a refusal, which takes the
// text away and is returned for the form to show. Nothing is left waiting. Text with nothing in it
// is not shown (the server will refuse it).
export async function sendIntoTail(
  key: string,
  text: string,
  run: () => Promise<{ error?: string; row?: TailRow } | undefined>,
): Promise<string | undefined> {
  const id = nextPending++;
  const epoch = currentEpoch();
  // Another visitor's tab state is not this one's to write to.
  const settle = (row: TailRow | undefined) => {
    if (epoch === currentEpoch()) {
      updateTail(key, (tail) => settlePending(tail, id, row));
    }
  };
  if (text.trim()) updateTail(key, (tail) => addPending(tail, { id, text }));
  try {
    const answer = await run();
    settle(answer?.row);
    return answer?.error;
  } catch (error) {
    settle(undefined);
    throw error;
  }
}

// What a poll of the tail answers: the rows after what the tail holds, that the thread was
// changed under it and the page must be drawn again, or that polling is over.
export type TailPoll = { rows: TailRow[] } | { reload: true } | { stop: true };
