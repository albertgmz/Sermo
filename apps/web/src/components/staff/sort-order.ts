// The arithmetic of the sort page (sort-form.tsx), kept apart to be tested on its own.

// The list with the entry at `index` moved `by` places (-1 up, 1 down); the same list when that
// would leave its ends.
export function moved<T>(list: readonly T[], index: number, by: -1 | 1): T[] {
  const target = index + by;
  if (index < 0 || index >= list.length || target < 0 || target >= list.length)
    return [...list];
  const next = [...list];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

// The position to save for each entry, in the new order. The positions the entries had are handed
// out again from the lowest, so an entry that did not move keeps its number and the order action
// saves only those that did. When two entries shared a number (their order was the backend's own
// choice) that cannot express the new order, so every entry is numbered anew, ten apart.
export function positionsFor(entries: readonly { position: number }[]) {
  const held = entries.map((entry) => entry.position).sort((a, b) => a - b);
  const distinct = held.every(
    (position, i) => i === 0 || position > held[i - 1],
  );
  return distinct ? held : entries.map((_, i) => (i + 1) * 10);
}

// Keeps the keyboard on the arrow that moved an entry. React reorders a list by taking nodes out
// and putting them back, and a focused node taken out loses the focus (moving an entry down moves
// its own node). The arrow asks for the focus with `want`; `restore`, run once the list is drawn
// again, gives it to whatever node now holds that key.
export function focusKeeper<Node extends { focus(): void }>() {
  const nodes = new Map<string, Node>();
  let wanted: string | undefined;
  return {
    ref: (key: string) => (node: Node | null) => {
      if (node) nodes.set(key, node);
      else nodes.delete(key);
    },
    want(key: string) {
      wanted = key;
    },
    restore() {
      if (wanted === undefined) return;
      nodes.get(wanted)?.focus();
      wanted = undefined;
    },
  };
}
