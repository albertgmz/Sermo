// Moving between the posts and cards of a page with `j` and `k`. The items are the elements marked
// `data-shortcut-item`, in document order; the current one is the one that holds the focus.

export const ITEM_SELECTOR = "[data-shortcut-item]";

// Where `j` (1) or `k` (-1) goes from `current` (-1: none) among `count` items. It stops at the
// first and the last: the list does not wrap, and a feed that loads more has more items the next
// time the key is pressed.
export function stepIndex(count: number, current: number, delta: 1 | -1) {
  if (count === 0) return -1;
  return Math.min(count - 1, Math.max(0, current + delta));
}

// An item scrolled to by `j` or `k` sits 1rem (16px, the scroll margin) under the header (57px,
// the scroll padding in globals.css); one more pixel is allowed for rounding.
const AT_TOP = 74;

// With no item holding the focus, the one the reader is at: the last whose top is at or above the
// top of the window (-1 when every item is still below it). `tops` are in document order.
export function itemAtWindowTop(tops: readonly number[]) {
  let at = -1;
  for (const [index, top] of tops.entries()) {
    if (top <= AT_TOP) at = index;
    else break;
  }
  return at;
}
