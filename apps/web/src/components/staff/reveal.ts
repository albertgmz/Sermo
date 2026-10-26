// The way the panel shows the row a search result led to (a setting, a permission): scrolled to
// the middle of the window, its first control focused, and marked for a moment. A row that can be
// a target takes `FOUND` among its classes; `reveal` sets the `data-found` they key on.

// How long the mark stays.
const SHOW_MS = 2500;

export const FOUND =
  "transition-[background-color,box-shadow] duration-500 data-found:bg-primary/10 data-found:ring-2 data-found:ring-ring data-found:ring-inset motion-reduce:transition-none";

// A value inside a quoted attribute selector.
const quoted = (value: string) => `"${value.replace(/["\\]/g, "\\$&")}"`;

// The rows an address's query names, best first: a setting's row (`?setting=<name>`, then the
// first of the rows under the name), or a permission's (`?permission=<id>`). None for another
// address.
export function targetSelectors(search: string): string[] {
  const params = new URLSearchParams(search);
  const setting = params.get("setting");
  if (setting)
    return [
      `[data-field=${quoted(setting)}]`,
      `[data-field^=${quoted(`${setting}.`)}]`,
    ];
  const permission = params.get("permission");
  return permission ? [`[data-permission=${quoted(permission)}]`] : [];
}

// The first copy of the row that is drawn: a page left earlier can stay in the document, hidden,
// with the same rows.
function drawnRow(root: ParentNode, selector: string) {
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

// Reveals the row the query names inside `root`; whether there was one.
export function revealTarget(root: ParentNode, search: string) {
  for (const selector of targetSelectors(search)) {
    const row = drawnRow(root, selector);
    if (row) {
      reveal(row);
      return true;
    }
  }
  return false;
}
