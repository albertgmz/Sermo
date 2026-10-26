// The way the panel shows the row a search result led to (a setting, a permission): scrolled to
// the middle of the window, its first control focused, and marked for a moment. A row that can be
// a target takes `FOUND` among its classes; `reveal` sets the `data-found` they key on.

// How long the mark stays.
const SHOW_MS = 2500;

export const FOUND =
  "transition-[background-color,box-shadow] duration-500 data-found:bg-primary/10 data-found:ring-2 data-found:ring-ring data-found:ring-inset motion-reduce:transition-none";

// The first copy of the row that is drawn: a page left earlier can stay in the document, hidden,
// with the same rows.
export function drawnRow(root: ParentNode, selector: string) {
  for (const element of root.querySelectorAll<HTMLElement>(selector))
    if (element.getClientRects().length > 0) return element;
  return null;
}

export function reveal(row: HTMLElement) {
  const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  row.scrollIntoView({ block: "center", behavior: still ? "auto" : "smooth" });
  row
    .querySelector<HTMLElement>(
      "input:not([type=hidden]), select, textarea, button",
    )
    ?.focus({ preventScroll: true });
  row.setAttribute("data-found", "");
  window.setTimeout(() => row.removeAttribute("data-found"), SHOW_MS);
}
