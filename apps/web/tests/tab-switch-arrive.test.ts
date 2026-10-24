import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  arriveAt,
  rememberTitle,
  type Titled,
} from "@/components/forum/tab-switch-arrive";

// What a tab switch does around a part that comes in, in the module fetched with the first press:
// the title it started from is remembered once, the title follows the part shown, the keyboard
// returns to the link pressed, and the screen goes to the anchor or to the top of the part.

const names = ["document", "location", "getComputedStyle", "CSS"] as const;
const saved = names.map((name) =>
  Object.getOwnPropertyDescriptor(globalThis, name),
);
const set = (name: string, value: unknown) =>
  Object.defineProperty(globalThis, name, { value, configurable: true });

type Link = {
  focused: boolean;
  focus: () => void;
  getClientRects: () => number[];
};
const link = (visible: boolean): Link => {
  const found: Link = {
    focused: false,
    focus: () => {
      found.focused = true;
    },
    getClientRects: () => (visible ? [1] : []),
  };
  return found;
};

function node(options: { part?: string; links?: Link[]; top?: number } = {}) {
  const scrolled: string[] = [];
  return {
    scrolled,
    querySelector: () =>
      options.part ? { getAttribute: () => options.part } : null,
    querySelectorAll: () => options.links ?? [],
    getBoundingClientRect: () => ({ top: options.top ?? 100 }),
    scrollIntoView: () => scrolled.push("part"),
  } as unknown as HTMLDivElement & { scrolled: string[] };
}

let doc: {
  title: string;
  activeElement: unknown;
  body: unknown;
  getElementById: (id: string) => unknown;
};
beforeEach(() => {
  doc = {
    title: "Feed - Latest | Site",
    activeElement: null,
    body: {},
    getElementById: () => null,
  };
  doc.activeElement = doc.body;
  set("document", doc);
  set("location", { hash: "" });
  set("getComputedStyle", () => ({ scrollPaddingTop: "64" }));
  set("CSS", { escape: (text: string) => text });
});
afterEach(() => {
  names.forEach((name, i) => {
    const descriptor = saved[i];
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete (globalThis as Record<string, unknown>)[name];
  });
});

test("the title and the part's name are remembered once, from the part the server drew", () => {
  const titled = { current: null as Titled | null };
  rememberTitle(node({ part: "Latest" }), titled);
  expect(titled.current).toEqual({
    title: "Feed - Latest | Site",
    part: "Latest",
  });
  doc.title = "Feed - Popular | Site";
  rememberTitle(node({ part: "Popular" }), titled);
  expect(titled.current?.part).toBe("Latest");
});

test("a part with no name of its own is not remembered", () => {
  const titled = { current: null as Titled | null };
  rememberTitle(node(), titled);
  expect(titled.current).toBeNull();
});

test("the title follows the part that came in, from the first press and the next", () => {
  const titled = { current: null as Titled | null };
  rememberTitle(node({ part: "Latest" }), titled);
  arriveAt(node({ part: "Popular" }), null, titled);
  expect(doc.title).toBe("Feed - Popular | Site");
  arriveAt(node({ part: "Unread" }), null, titled);
  expect(doc.title).toBe("Feed - Unread | Site");
});

test("a part with no name, or a switch that remembered none, leaves the title alone", () => {
  const titled = { current: { title: doc.title, part: "Latest" } };
  arriveAt(node(), null, titled);
  expect(doc.title).toBe("Feed - Latest | Site");
  arriveAt(node({ part: "Popular" }), null, { current: null });
  expect(doc.title).toBe("Feed - Latest | Site");
});

test("the keyboard returns to the link pressed, the one on screen, unless it is somewhere already", () => {
  const hidden = link(false);
  const shown = link(true);
  arriveAt(node({ links: [hidden, shown] }), "/?tab=popular", {
    current: null,
  });
  expect(hidden.focused).toBe(false);
  expect(shown.focused).toBe(true);
  const other = link(true);
  doc.activeElement = {};
  arriveAt(node({ links: [other] }), "/?tab=popular", { current: null });
  expect(other.focused).toBe(false);
});

test("the screen goes to the part's top when it is above the header, to the anchor when the address names one", () => {
  const above = node({ top: 10 });
  arriveAt(above, null, { current: null });
  expect(above.scrolled).toEqual(["part"]);
  const below = node({ top: 200 });
  arriveAt(below, null, { current: null });
  expect(below.scrolled).toEqual([]);
  const anchored: string[] = [];
  set("location", { hash: "#post-5" });
  doc.getElementById = () => ({
    scrollIntoView: () => anchored.push("anchor"),
  });
  const top = node({ top: 10 });
  arriveAt(top, null, { current: null });
  expect(anchored).toEqual(["anchor"]);
  expect(top.scrolled).toEqual([]);
});
