import { setItemState, useItemState } from "@/lib/item-state";

// The unread counts of the header and the phone bar: what the server drew them as, and what the
// last poll found. Everything that shows one reads it here, so they agree.
export type CounterKind = "conversations" | "notifications";

const keyOf = (kind: CounterKind) => `counter:${kind}`;

export const useCounter = (kind: CounterKind, drawn: number) =>
  useItemState(keyOf(kind), drawn);

export function publishCounters(
  drawn: Record<CounterKind, number>,
  found: Record<CounterKind, number>,
) {
  for (const kind of ["conversations", "notifications"] as const) {
    setItemState(keyOf(kind), drawn[kind], found[kind]);
  }
}
