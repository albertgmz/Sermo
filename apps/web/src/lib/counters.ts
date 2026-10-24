import { setItemState, useItemState } from "@/lib/item-state";

// The unread counts of the header and the phone bar: what the server drew them as, and what the
// last poll found. Everything that shows one reads it here, so they agree. `props` are the
// component's own: a header drawn again after the poll shows what the server drew.
export type CounterKind = "conversations" | "notifications";

const keyOf = (kind: CounterKind) => `counter:${kind}`;

export const useCounter = (kind: CounterKind, drawn: number, props: object) =>
  useItemState(keyOf(kind), drawn, props);

// What the layout last drew (kept by the counters poll), so a count emptied in the browser is
// held against the number every badge was drawn with.
let layoutDrawn: Record<CounterKind, number> | undefined;

export function rememberDrawn(drawn: Record<CounterKind, number>) {
  layoutDrawn = drawn;
}

// The alerts were opened: every alerts badge shows none until the server draws a count again.
export function clearAlertsBadge() {
  if (layoutDrawn)
    setItemState(keyOf("notifications"), layoutDrawn.notifications, 0);
}

export function publishCounters(
  drawn: Record<CounterKind, number>,
  found: Record<CounterKind, number>,
) {
  for (const kind of ["conversations", "notifications"] as const) {
    setItemState(keyOf(kind), drawn[kind], found[kind]);
  }
}
