import { ITEM_SELECTOR, itemAtWindowTop, stepIndex } from "./shortcut-items";

// What each shortcut does to the page. The pages mark what a shortcut works on: posts and cards
// with `data-shortcut-item`, the entry to a new thread with `data-shortcut="create"`, the reply
// form with `data-shortcut="reply"` and the header's search with `data-shortcut="search"`. A page
// without the mark has nothing for the key to do. Each action says whether it did anything: the
// key is cancelled only then.

// Something the visitor has opened on top of the page (a dialog, a menu, a list of choices): the
// keys wait until it is closed.
const OPEN_POPUP =
  '[role="dialog"][data-open], [role="alertdialog"][data-open], [role="menu"][data-open], [role="listbox"][data-open]';

export function popupOpen(doc: Document) {
  return doc.querySelector(OPEN_POPUP) !== null;
}

const drawn = (element: Element) => element.getClientRects().length > 0;

function marked(doc: Document, name: string) {
  return [
    ...doc.querySelectorAll<HTMLElement>(`[data-shortcut="${name}"]`),
  ].filter(drawn);
}

// `j` (1) and `k` (-1): focus the next or previous post or card and bring it to the top of the
// window. The browser draws the focus ring (`globals.css` keeps it inside the item).
export function moveToItem(doc: Document, delta: 1 | -1) {
  const items = [...doc.querySelectorAll<HTMLElement>(ITEM_SELECTOR)].filter(
    drawn,
  );
  // The item holding the focus is the current one only while it is in the window: a long list
  // keeps the focused row mounted after the reader has scrolled far from it.
  const height = doc.documentElement.clientHeight;
  const held = doc.activeElement?.closest?.(ITEM_SELECTOR) as
    | HTMLElement
    | null
    | undefined;
  const rect = held?.getBoundingClientRect();
  const at =
    held && rect && rect.bottom > 0 && rect.top < height
      ? items.indexOf(held)
      : -1;
  const current =
    at === -1
      ? itemAtWindowTop(items.map((item) => item.getBoundingClientRect().top))
      : at;
  const target = items[stepIndex(items.length, current, delta)];
  if (!target) return false;
  if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
  target.focus({ preventScroll: true });
  target.scrollIntoView({ block: "start" });
  return true;
}

// `/`: the search page's own field when it is open, else the header's search, else the search page.
export function openSearch(doc: Document, go: (path: string) => void) {
  const field = doc.getElementById("search-query");
  if (field instanceof HTMLInputElement) {
    field.focus();
    field.select();
    return true;
  }
  const [trigger] = marked(doc, "search");
  if (trigger) trigger.click();
  else go("/search");
  return true;
}

// `c`: the page's way to start a thread (the forum page's button), when it has one.
export function openCreate(doc: Document) {
  const [link] = marked(doc, "create");
  link?.click();
  return link !== undefined;
}

// `r`: the reply form of the thread, with the cursor in its editor when the editor is drawn.
export function focusReply(doc: Document) {
  const [form] = marked(doc, "reply");
  if (!form) return false;
  form.scrollIntoView({ block: "center" });
  form.querySelector<HTMLElement>('[contenteditable="true"]')?.focus();
  return true;
}
