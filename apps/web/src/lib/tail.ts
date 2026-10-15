import type { ReactNode } from "react";
import { createKeyedStore } from "@/lib/keyed-store";

// The end of a conversation or of the last page of a thread, as it grows while the visitor reads:
// rows drawn on the server that arrived after the page was drawn (found by a poll, or the
// visitor's own, answered by the server), and the texts the visitor has sent that the server has
// not answered yet. `mark` is what the next poll asks "after" (a message id, a post position) and
// `id` is the row's own record.
export type TailRow = {
  key: string;
  id: number;
  mark: number;
  node: ReactNode;
};
export type Tail = {
  rows: TailRow[];
  pending: { id: number; text: string }[];
};

export const EMPTY_TAIL: Tail = { rows: [], pending: [] };

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

// The newest row held, or what the page was drawn with.
export function newestHeld(
  tail: Tail,
  drawn: { id: number; mark: number },
): { id: number; mark: number } {
  const last = tail.rows.at(-1);
  return last ? { id: last.id, mark: last.mark } : drawn;
}

const tails = createKeyedStore<Tail>();

export const useTail = (key: string) => tails.use(key);
// Whether a tail is on the screen under that key: a form that finds none sends the old way, with a
// redirect, to a page that has it.
export const tailIsShown = (key: string) => tails.get(key) !== undefined;
export const readTail = (key: string) => tails.get(key);
export const writeTail = (key: string, tail: Tail | undefined) =>
  tails.set(key, tail);
export function updateTail(key: string, change: (tail: Tail) => Tail) {
  const tail = tails.get(key);
  if (tail) tails.set(key, change(tail));
}

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
  if (text.trim()) updateTail(key, (tail) => addPending(tail, { id, text }));
  try {
    const answer = await run();
    updateTail(key, (tail) => settlePending(tail, id, answer?.row));
    return answer?.error;
  } catch (error) {
    updateTail(key, (tail) => settlePending(tail, id, undefined));
    throw error;
  }
}
