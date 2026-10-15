import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  spyOn,
  test,
} from "bun:test";
import { getHotkeyManager, getSequenceManager } from "@tanstack/react-hotkeys";
import { createShortcuts, OPTIONS } from "./shortcut-bindings";
import { ITEM_SELECTOR } from "./shortcut-items";
import { SEQUENCE_TIMEOUT, SHORTCUTS } from "./shortcuts";

// The shortcuts are registered with the library's own managers, as the provider's hooks do, on a
// document made of plain objects. Keys are sent to the document's listeners as the browser would.
class FakeElement {
  isContentEditable = false;
  getClientRects() {
    return [{}];
  }
}
class FakeInput extends FakeElement {
  constructor(public type = "text") {
    super();
  }
}
class FakeTextArea extends FakeElement {}
class FakeSelect extends FakeElement {}
class FakeDocument {}

const globals = globalThis as Record<string, unknown>;
const saved = new Map<string, unknown>();
const log: string[] = [];
let doc: FakeDocument & {
  activeElement: unknown;
  listeners: Map<string, ((event: unknown) => void)[]>;
  lists: Map<string, unknown[]>;
  ids: Map<string, unknown>;
};
let clock = 1_000_000;
let nowSpy: ReturnType<typeof spyOn>;
let handles: { unregister: () => void }[] = [];

const POPUP =
  '[role="dialog"][data-open], [role="alertdialog"][data-open], [role="menu"][data-open], [role="listbox"][data-open]';

beforeAll(() => {
  const fakes: Record<string, unknown> = {
    HTMLElement: FakeElement,
    HTMLInputElement: FakeInput,
    HTMLTextAreaElement: FakeTextArea,
    HTMLSelectElement: FakeSelect,
    Document: FakeDocument,
    Node: { DOCUMENT_NODE: 9 },
  };
  for (const [name, value] of Object.entries(fakes)) {
    saved.set(name, globals[name]);
    globals[name] = value;
  }
  saved.set("document", globals.document);
  saved.set("window", globals.window);
});

afterAll(() => {
  for (const [name, value] of saved) globals[name] = value;
});

function item(name: string) {
  const self = {
    name,
    attributes: new Map<string, string>(),
    getClientRects: () => [{}],
    getBoundingClientRect: () => ({ top: 0 }),
    hasAttribute: (key: string) => self.attributes.has(key),
    setAttribute: (key: string, value: string) =>
      self.attributes.set(key, value),
    focus: () => {
      doc.activeElement = self;
      log.push(`focus ${name}`);
    },
    scrollIntoView: () => {},
    closest: (selector: string) => (selector === ITEM_SELECTOR ? self : null),
  };
  return self;
}

beforeEach(() => {
  log.length = 0;
  const fake = Object.assign(new FakeDocument(), {
    nodeType: 9,
    activeElement: null as unknown,
    listeners: new Map<string, ((event: unknown) => void)[]>(),
    lists: new Map<string, unknown[]>(),
    ids: new Map<string, unknown>(),
    documentElement: {},
    addEventListener(type: string, listener: (event: unknown) => void) {
      fake.listeners.set(type, [...(fake.listeners.get(type) ?? []), listener]);
    },
    removeEventListener(type: string, listener: (event: unknown) => void) {
      fake.listeners.set(
        type,
        (fake.listeners.get(type) ?? []).filter((l) => l !== listener),
      );
    },
    querySelectorAll: (selector: string) => fake.lists.get(selector) ?? [],
    querySelector: (selector: string) => fake.lists.get(selector)?.[0] ?? null,
    getElementById: (id: string) => fake.ids.get(id) ?? null,
  });
  doc = fake;
  globals.document = fake;
  globals.window = {};
  clock = 1_000_000;
  nowSpy = spyOn(Date, "now").mockImplementation(() => clock);
  handles = [];
});

afterEach(() => {
  for (const handle of handles) handle.unregister();
  nowSpy.mockRestore();
});

// Registers the shortcuts the way the provider does and returns what they were handed.
function register({ enabled = true } = {}) {
  const go: string[] = [];
  let help = 0;
  const { hotkeys, sequences } = createShortcuts({
    go: (path) => go.push(path),
    openHelp: () => {
      help += 1;
    },
  });
  for (const { hotkey, callback } of hotkeys) {
    handles.push(
      getHotkeyManager().register(hotkey, callback, {
        ...OPTIONS,
        enabled,
        conflictBehavior: "allow",
      }),
    );
  }
  for (const { sequence, callback } of sequences) {
    handles.push(
      getSequenceManager().register(sequence, callback, {
        ...OPTIONS,
        enabled,
        timeout: SEQUENCE_TIMEOUT,
        conflictBehavior: "allow",
      }),
    );
  }
  return { go, helpOpened: () => help, hotkeys, sequences };
}

const CODES: Record<string, string> = { "/": "Slash", "?": "Slash" };

function press(
  key: string,
  {
    target = {} as unknown,
    shift = key === "?",
    ctrl = false,
    wait = 100,
  }: { target?: unknown; shift?: boolean; ctrl?: boolean; wait?: number } = {},
) {
  clock += wait;
  const event = {
    type: "keydown",
    key,
    code: CODES[key] ?? `Key${key.toUpperCase()}`,
    ctrlKey: ctrl,
    shiftKey: shift,
    altKey: false,
    metaKey: false,
    repeat: false,
    isComposing: false,
    currentTarget: doc,
    target,
    timeStamp: clock,
    defaultPrevented: false,
    composedPath: () => [target],
    getModifierState: () => false,
    preventDefault() {
      event.defaultPrevented = true;
    },
    stopPropagation() {},
  };
  doc.activeElement = target;
  for (const listener of doc.listeners.get("keydown") ?? []) listener(event);
  return event;
}

function createLink() {
  const link = {
    getClientRects: () => [{}],
    click: () => log.push("create"),
  };
  doc.lists.set('[data-shortcut="create"]', [link]);
}

test("every shortcut that is not left to the page or the editor is registered", () => {
  const { hotkeys, sequences } = register();
  const registered = SHORTCUTS.filter((shortcut) => !shortcut.native);
  const single = registered.filter((shortcut) => shortcut.keys.length === 1);
  // One binding per single key, plus the `g` that `c` listens for.
  expect(hotkeys).toHaveLength(single.length + 1);
  expect(sequences).toHaveLength(registered.length - single.length);
  const keys = hotkeys.map((binding) => String(binding.hotkey).toLowerCase());
  expect(keys).not.toContain("escape");
  expect(keys.join("")).not.toContain("\\");
});

test("? opens the help, with shift as it is typed on a US or a Spanish keyboard", () => {
  const shortcuts = register();
  const event = press("?");
  expect(shortcuts.helpOpened()).toBe(1);
  expect(event.defaultPrevented).toBe(true);
  press("?", { shift: false });
  expect(shortcuts.helpOpened()).toBe(2);
});

test("/ opens the search, also where it needs shift", () => {
  const shortcuts = register();
  press("/", { shift: false });
  press("/", { shift: true });
  expect(shortcuts.go).toEqual(["/search", "/search"]);
});

test("j and k move between the items", () => {
  register();
  const [a, b] = [item("a"), item("b")];
  doc.lists.set(ITEM_SELECTOR, [a, b]);
  doc.activeElement = a;
  press("j");
  press("k");
  press("j");
  expect(log).toEqual(["focus b", "focus a", "focus b"]);
});

test("c starts a thread where the page has the way to, g then c goes to the conversations and starts nothing", () => {
  const shortcuts = register();
  createLink();
  press("c");
  expect(log).toEqual(["create"]);
  press("g");
  press("c");
  expect(shortcuts.go).toEqual(["/conversations"]);
  expect(log).toEqual(["create"]);
  // The `g` is used up: the next `c` is a `c` again.
  press("c");
  expect(log).toEqual(["create", "create"]);
});

test("a g left waiting longer than the timeout does not take the next c", () => {
  const shortcuts = register();
  createLink();
  press("g");
  press("c", { wait: SEQUENCE_TIMEOUT + 500 });
  expect(shortcuts.go).toEqual([]);
  expect(log).toEqual(["create"]);
});

test("g then h, n and c go home, to the alerts and to the conversations", () => {
  const shortcuts = register();
  for (const second of ["h", "n", "c"]) {
    press("g");
    press(second);
  }
  expect(shortcuts.go).toEqual(["/", "/notifications", "/conversations"]);
});

test("a sequence needs its second key in time, in order, and from the g itself", () => {
  const shortcuts = register();
  press("g");
  press("h", { wait: SEQUENCE_TIMEOUT + 500 });
  expect(shortcuts.go).toEqual([]);
  press("h");
  press("g");
  expect(shortcuts.go).toEqual([]);
  press("g");
  press("x");
  press("n");
  expect(shortcuts.go).toEqual([]);
});

test("r brings the reply form into view", () => {
  register();
  const form = {
    getClientRects: () => [{}],
    scrollIntoView: () => log.push("form"),
    querySelector: () => null,
  };
  doc.lists.set('[data-shortcut="reply"]', [form]);
  press("r");
  expect(log).toEqual(["form"]);
});

test("nothing fires while the member is typing in a field", () => {
  const shortcuts = register();
  createLink();
  doc.lists.set(ITEM_SELECTOR, [item("a")]);
  const editable = new FakeElement();
  editable.isContentEditable = true;
  const fields = [
    new FakeInput("text"),
    new FakeInput("search"),
    new FakeTextArea(),
    new FakeSelect(),
    editable,
  ];
  for (const field of fields) {
    for (const key of ["?", "/", "j", "k", "r", "c"]) {
      const event = press(key, { target: field });
      expect(event.defaultPrevented).toBe(false);
    }
    press("g", { target: field });
    press("h", { target: field });
    press("g", { target: field });
    press("n", { target: field });
  }
  expect(shortcuts.helpOpened()).toBe(0);
  expect(shortcuts.go).toEqual([]);
  expect(log).toEqual([]);
});

test("a button in a form is not a field", () => {
  const shortcuts = register();
  press("?", { target: new FakeInput("submit") });
  expect(shortcuts.helpOpened()).toBe(1);
});

test("a key with ctrl held is not a shortcut", () => {
  const shortcuts = register();
  createLink();
  const event = press("c", { ctrl: true });
  press("?", { ctrl: true });
  expect(log).toEqual([]);
  expect(shortcuts.helpOpened()).toBe(0);
  expect(event.defaultPrevented).toBe(false);
});

test("with the preference off nothing fires, the help included", () => {
  const shortcuts = register({ enabled: false });
  createLink();
  doc.lists.set(ITEM_SELECTOR, [item("a"), item("b")]);
  for (const key of ["?", "/", "j", "k", "r", "c"]) {
    expect(press(key).defaultPrevented).toBe(false);
  }
  press("g");
  press("h");
  expect(shortcuts.helpOpened()).toBe(0);
  expect(shortcuts.go).toEqual([]);
  expect(log).toEqual([]);
});

test("an open dialog or menu holds every key and the key is left alone", () => {
  const shortcuts = register();
  createLink();
  doc.lists.set(ITEM_SELECTOR, [item("a"), item("b")]);
  doc.lists.set(POPUP, [{}]);
  for (const key of ["?", "/", "j", "k", "r", "c"]) {
    expect(press(key).defaultPrevented).toBe(false);
  }
  press("g");
  press("h");
  expect(shortcuts.helpOpened()).toBe(0);
  expect(shortcuts.go).toEqual([]);
  expect(log).toEqual([]);
});

test("a key that is not a shortcut is left to the page", () => {
  const shortcuts = register();
  expect(press("x").defaultPrevented).toBe(false);
  expect(press("Escape", { shift: false }).defaultPrevented).toBe(false);
  expect(shortcuts.helpOpened()).toBe(0);
});
