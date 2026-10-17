import { moved, positionsFor } from "@/components/staff/sort-order";

// The arithmetic of the sort page with several lists under one Save, kept apart to be tested on
// its own. A group is one parent's children in their current order; an entry is moved only within
// its group.
export type OrderEntry = { id: number; position: number };
export type OrderGroup = { id: string; items: OrderEntry[] };

// The groups with the entry at `index` of group `groupId` moved `by` places (-1 up, 1 down); the
// other groups are the very same lists.
export function moveInGroup<G extends OrderGroup>(
  groups: readonly G[],
  groupId: string,
  index: number,
  by: -1 | 1,
): G[] {
  return groups.map((group) =>
    group.id === groupId
      ? { ...group, items: moved(group.items, index, by) }
      : group,
  );
}

const sameOrder = (a: readonly OrderEntry[], b: readonly OrderEntry[]) =>
  a.length === b.length && a.every((entry, i) => entry.id === b[i].id);

// The position to send for each entry (by id). A group still in its starting order keeps every
// number it came with, so only the groups that were moved are renumbered (`positionsFor`), and in
// them only the entries whose place changed get a new number when the numbers allow it.
export function groupPositions(
  current: readonly OrderGroup[],
  initial: readonly OrderGroup[],
): Map<number, number> {
  const positions = new Map<number, number>();
  for (const group of current) {
    const start = initial.find((first) => first.id === group.id)?.items ?? [];
    const numbers = sameOrder(group.items, start)
      ? group.items.map((entry) => entry.position)
      : positionsFor(group.items);
    for (const [i, entry] of group.items.entries()) {
      positions.set(entry.id, numbers[i]);
    }
  }
  return positions;
}
