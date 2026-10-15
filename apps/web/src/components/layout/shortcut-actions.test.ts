import { afterAll, beforeAll, expect, test } from "bun:test";
import {
  focusReply,
  moveToItem,
  openCreate,
  openSearch,
  popupOpen,
} from "./shortcut-actions";
import { ITEM_SELECTOR } from "./shortcut-items";

// A page made of plain objects: the actions ask the document for marked elements and act on them.
class FakeInput {
  focused = false;
  selected = false;
  focus() {
    this.focused = true;
  }
  select() {
    this.selected = true;
  }
}

type Page = ReturnType<typeof page>;

function page() {
  const log: string[] = [];
  const doc = {
    activeElement: null as unknown,
    documentElement: { clientHeight: 800 },
    lists: new Map<string, unknown[]>(),
    ids: new Map<string, unknown>(),
    querySelectorAll(selector: string) {
      return this.lists.get(selector) ?? [];
    },
    querySelector(selector: string) {
      return this.lists.get(selector)?.[0] ?? null;
    },
    getElementById(id: string) {
      return this.ids.get(id) ?? null;
    },
  };
  function element(
    name: string,
    { top = 0, drawn = true }: { top?: number; drawn?: boolean } = {},
  ) {
    const attributes = new Map<string, string>();
    const self = {
      name,
      attributes,
      editable: null as unknown,
      getClientRects: () => (drawn ? [{}] : []),
      getBoundingClientRect: () => ({ top, bottom: top + 100 }),
      hasAttribute: (key: string) => attributes.has(key),
      setAttribute: (key: string, value: string) => attributes.set(key, value),
      focus: () => {
        doc.activeElement = self;
        log.push(`focus ${name}`);
      },
      scrollIntoView: (options: unknown) =>
        log.push(`scroll ${name} ${JSON.stringify(options)}`),
      click: () => log.push(`click ${name}`),
      closest: (selector: string) => (selector === ITEM_SELECTOR ? self : null),
      querySelector: () => self.editable,
    };
    return self;
  }
  return { doc, log, element };
}

const asDocument = (p: Page) => p.doc as unknown as Document;

const globals = globalThis as Record<string, unknown>;
const had = globals.HTMLInputElement;
beforeAll(() => {
  globals.HTMLInputElement = FakeInput;
});
afterAll(() => {
  globals.HTMLInputElement = had;
});

function items(p: Page, tops: number[]) {
  const list = tops.map((top, index) => p.element(`item${index}`, { top }));
  p.doc.lists.set(ITEM_SELECTOR, list);
  return list;
}

test("j and k move the focus through the items and scroll each to the top", () => {
  const p = page();
  const [a, b, c] = items(p, [-300, 200, 700]);
  p.doc.activeElement = a;
  moveToItem(asDocument(p), 1);
  expect(p.doc.activeElement).toBe(b);
  moveToItem(asDocument(p), 1);
  expect(p.doc.activeElement).toBe(c);
  moveToItem(asDocument(p), -1);
  expect(p.doc.activeElement).toBe(b);
  expect(p.log).toContain('scroll item1 {"block":"start"}');
  expect(b.attributes.get("tabindex")).toBe("-1");
});

test("a focused item far from the window is not the current one: the reader's place is", () => {
  const p = page();
  // A long list keeps the focused row mounted after the reader has scrolled away from it.
  const [, b, , held] = items(p, [-100, 300, 700, 5000]);
  p.doc.activeElement = held;
  moveToItem(asDocument(p), 1);
  expect(p.doc.activeElement).toBe(b);
  const above = page();
  const [heldAbove, x] = items(above, [-4000, -3000, -200, 100, 500]);
  above.doc.activeElement = heldAbove;
  moveToItem(asDocument(above), -1);
  expect(above.doc.activeElement).toBe(x);
});

test("an item partly in the window is the current one when it holds the focus", () => {
  const p = page();
  const [, b, c] = items(p, [-500, -60, 300]);
  p.doc.activeElement = b;
  moveToItem(asDocument(p), 1);
  expect(p.doc.activeElement).toBe(c);
});

test("every action says whether it did anything", () => {
  const empty = page();
  expect(moveToItem(asDocument(empty), 1)).toBe(false);
  expect(openCreate(asDocument(empty))).toBe(false);
  expect(focusReply(asDocument(empty))).toBe(false);
  expect(openSearch(asDocument(empty), () => {})).toBe(true);
  const full = page();
  items(full, [0]);
  full.doc.lists.set('[data-shortcut="create"]', [full.element("new")]);
  full.doc.lists.set('[data-shortcut="reply"]', [full.element("form")]);
  expect(moveToItem(asDocument(full), 1)).toBe(true);
  expect(openCreate(asDocument(full))).toBe(true);
  expect(focusReply(asDocument(full))).toBe(true);
});

test("the list does not wrap: the last item stays the last and the first stays the first", () => {
  const p = page();
  const [a, , c] = items(p, [0, 300, 700]);
  p.doc.activeElement = c;
  moveToItem(asDocument(p), 1);
  expect(p.doc.activeElement).toBe(c);
  p.doc.activeElement = a;
  moveToItem(asDocument(p), -1);
  expect(p.doc.activeElement).toBe(a);
});

test("with the focus elsewhere, the first key starts from the item the reader is at", () => {
  const p = page();
  const [a, , c] = items(p, [-900, -20, 400]);
  p.doc.activeElement = { closest: () => null };
  moveToItem(asDocument(p), 1);
  expect(p.doc.activeElement).toBe(c);
  p.doc.activeElement = null;
  moveToItem(asDocument(p), -1);
  // The reader is at the second item, so k goes to the first.
  expect(p.doc.activeElement).toBe(a);
});

test("items that are not drawn are skipped, and a page without items does nothing", () => {
  const p = page();
  const a = p.element("a", { top: 0 });
  const hidden = p.element("hidden", { top: 100, drawn: false });
  const c = p.element("c", { top: 200 });
  p.doc.lists.set(ITEM_SELECTOR, [a, hidden, c]);
  p.doc.activeElement = a;
  moveToItem(asDocument(p), 1);
  expect(p.doc.activeElement).toBe(c);
  const empty = page();
  moveToItem(asDocument(empty), 1);
  expect(empty.log).toEqual([]);
});

test("an open dialog, menu or list of choices holds the keys", () => {
  const p = page();
  expect(popupOpen(asDocument(p))).toBe(false);
  p.doc.lists.set(
    '[role="dialog"][data-open], [role="alertdialog"][data-open], [role="menu"][data-open], [role="listbox"][data-open]',
    [{}],
  );
  expect(popupOpen(asDocument(p))).toBe(true);
});

test("/ focuses the search page field, else opens the header search, else goes to the search page", () => {
  const field = new FakeInput();
  const onPage = page();
  onPage.doc.ids.set("search-query", field);
  const go: string[] = [];
  openSearch(asDocument(onPage), (path) => go.push(path));
  expect(field.focused && field.selected).toBe(true);
  expect(go).toEqual([]);

  const withHeader = page();
  withHeader.doc.lists.set('[data-shortcut="search"]', [
    withHeader.element("panel"),
  ]);
  openSearch(asDocument(withHeader), (path) => go.push(path));
  expect(withHeader.log).toEqual(["click panel"]);
  expect(go).toEqual([]);

  const hiddenHeader = page();
  hiddenHeader.doc.lists.set('[data-shortcut="search"]', [
    hiddenHeader.element("panel", { drawn: false }),
  ]);
  openSearch(asDocument(hiddenHeader), (path) => go.push(path));
  expect(hiddenHeader.log).toEqual([]);
  expect(go).toEqual(["/search"]);
});

test("c uses the page way to start a thread, and does nothing on a page without one", () => {
  const p = page();
  openCreate(asDocument(p));
  expect(p.log).toEqual([]);
  p.doc.lists.set('[data-shortcut="create"]', [p.element("new thread")]);
  openCreate(asDocument(p));
  expect(p.log).toEqual(["click new thread"]);
});

test("r brings the reply form into view and puts the cursor in its editor", () => {
  const p = page();
  focusReply(asDocument(p));
  expect(p.log).toEqual([]);
  const form = p.element("form");
  const editor = p.element("editor");
  form.editable = editor;
  p.doc.lists.set('[data-shortcut="reply"]', [form]);
  focusReply(asDocument(p));
  expect(p.log).toEqual(['scroll form {"block":"center"}', "focus editor"]);
});

test("r on a form whose editor is not drawn yet still scrolls to it", () => {
  const p = page();
  const form = p.element("form");
  p.doc.lists.set('[data-shortcut="reply"]', [form]);
  focusReply(asDocument(p));
  expect(p.log).toEqual(['scroll form {"block":"center"}']);
});
