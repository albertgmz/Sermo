import { expect, test } from "bun:test";
import { createTrigger, type Opener } from "./lazy-popup-handlers";
import type { Opening } from "./lazy-popup-intent";

function fakeOpener() {
  const calls: string[] = [];
  const state = { pending: false };
  const opener: Opener = {
    warm: () => calls.push("warm"),
    open: () => {
      calls.push("open");
      state.pending = true;
    },
    cancel: () => {
      calls.push("cancel");
      state.pending = false;
    },
    get pending() {
      return state.pending;
    },
  };
  return { opener, calls };
}

// Timers that only run when the test says so.
function fakeTimers() {
  const waiting = new Map<number, () => void>();
  let next = 0;
  return {
    timers: {
      set: (run: () => void) => {
        next += 1;
        waiting.set(next, run);
        return next;
      },
      clear: (id: number) => {
        waiting.delete(id);
      },
    },
    waiting: () => waiting.size,
    fire: () => {
      for (const [id, run] of [...waiting]) {
        waiting.delete(id);
        run();
      }
    },
  };
}

function setup(opening: Opening) {
  const { opener, calls } = fakeOpener();
  const clock = fakeTimers();
  const trigger = createTrigger(opener, opening, clock.timers);
  return { trigger, calls, clock, handlers: trigger.handlers };
}

let prevented = 0;
const key = (name: string) => ({
  key: name,
  preventDefault: () => {
    prevented += 1;
  },
});
const click = (extra: Partial<Record<string, unknown>> = {}) => ({
  button: 0,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  preventDefault: () => {
    prevented += 1;
  },
  ...extra,
});

test("the first pointer, touch or focus fetches the code and opens nothing", () => {
  const { handlers, calls } = setup("click");
  handlers.onPointerEnter({ pointerType: "mouse" });
  handlers.onTouchStart();
  handlers.onFocus();
  expect(calls).toEqual(["warm", "warm", "warm"]);
});

test("a click opens, holds the browser's own action back, and says it came from a pointer", () => {
  prevented = 0;
  const { handlers, calls, trigger } = setup("click");
  handlers.onPointerDown({ pointerType: "mouse" });
  handlers.onClick(click());
  expect(calls).toEqual(["open"]);
  expect(prevented).toBe(1);
  expect(trigger.gesture().openedBy).toBe("pointer");
});

test("a touch press is a touch open; a click with no press before it is the keyboard's (Enter, a shortcut)", () => {
  const touch = setup("click");
  touch.handlers.onPointerDown({ pointerType: "touch" });
  touch.handlers.onClick(click());
  expect(touch.trigger.gesture().openedBy).toBe("touch");

  const enter = setup("click");
  enter.handlers.onClick(click());
  expect(enter.trigger.gesture().openedBy).toBe("keyboard");
});

test("a press that turned into a scroll, or a key since, no longer makes the next click a touch", () => {
  const scrolled = setup("click");
  scrolled.handlers.onPointerDown({ pointerType: "touch" });
  scrolled.handlers.onPointerCancel();
  scrolled.handlers.onClick(click());
  expect(scrolled.trigger.gesture().openedBy).toBe("keyboard");

  const typed = setup("click");
  typed.handlers.onPointerDown({ pointerType: "touch" });
  typed.handlers.onKeyDown(key("Enter"));
  typed.handlers.onClick(click());
  expect(typed.trigger.gesture().openedBy).toBe("keyboard");
});

test("a modified or non-primary click is the browser's, not the popup's", () => {
  prevented = 0;
  const { handlers, calls } = setup("click");
  handlers.onClick(click({ ctrlKey: true }));
  handlers.onClick(click({ metaKey: true }));
  handlers.onClick(click({ button: 1 }));
  expect(calls).toEqual([]);
  expect(prevented).toBe(0);
});

test("pressing again while the popup is on its way withdraws it", () => {
  const { handlers, calls } = setup("click");
  handlers.onClick(click());
  handlers.onClick(click());
  expect(calls).toEqual(["open", "cancel"]);
});

test("Escape withdraws a popup that is on its way", () => {
  const { handlers, calls } = setup("click");
  handlers.onClick(click());
  handlers.onKeyDown(key("Escape"));
  expect(calls).toEqual(["open", "cancel"]);
});

test("a menu opens on ArrowDown and ArrowUp, remembering which, and not on other keys", () => {
  prevented = 0;
  const down = setup("menu");
  down.handlers.onKeyDown(key("ArrowDown"));
  expect(down.calls).toEqual(["open"]);
  expect(down.trigger.gesture()).toEqual({
    openedBy: "keyboard",
    openKey: "ArrowDown",
  });
  expect(prevented).toBe(1);

  const up = setup("menu");
  up.handlers.onKeyDown(key("ArrowUp"));
  expect(up.trigger.gesture().openKey).toBe("ArrowUp");

  const other = setup("menu");
  other.handlers.onKeyDown(key("a"));
  other.handlers.onKeyDown(key("Enter"));
  expect(other.calls).toEqual([]);
});

test("a click or a plain button ignores the arrow keys", () => {
  const { handlers, calls } = setup("click");
  handlers.onKeyDown(key("ArrowDown"));
  expect(calls).toEqual([]);
});

test("Space on a link opens on key up, after holding the page back on key down", () => {
  prevented = 0;
  const { handlers, calls, trigger } = setup("link");
  handlers.onKeyDown(key(" "));
  expect(prevented).toBe(1);
  expect(calls).toEqual([]);
  handlers.onKeyUp(key(" "));
  expect(calls).toEqual(["open"]);
  expect(trigger.gesture().openedBy).toBe("keyboard");
});

test("a Space that went down elsewhere and came up on the link opens nothing", () => {
  const { handlers, calls } = setup("link");
  handlers.onKeyUp(key(" "));
  expect(calls).toEqual([]);
});

test("Space on a button is left to the button's own click", () => {
  prevented = 0;
  const { handlers, calls } = setup("click");
  handlers.onKeyDown(key(" "));
  handlers.onKeyUp(key(" "));
  expect(calls).toEqual([]);
  expect(prevented).toBe(0);
});

test("a tooltip opens once the pointer has rested, and not for a touch", () => {
  const rest = setup("hover");
  rest.handlers.onPointerEnter({ pointerType: "mouse" });
  expect(rest.calls).toEqual(["warm"]);
  expect(rest.clock.waiting()).toBe(1);
  rest.clock.fire();
  expect(rest.calls).toEqual(["warm", "open"]);

  const touch = setup("hover");
  touch.handlers.onPointerEnter({ pointerType: "touch" });
  expect(touch.clock.waiting()).toBe(0);
  expect(touch.calls).toEqual(["warm"]);
});

test("a pointer that leaves before it has rested, or while the tooltip is on its way, opens nothing", () => {
  const early = setup("hover");
  early.handlers.onPointerEnter({ pointerType: "mouse" });
  early.handlers.onPointerLeave();
  expect(early.clock.waiting()).toBe(0);
  early.clock.fire();
  expect(early.calls).toEqual(["warm", "cancel"]);

  const late = setup("hover");
  late.handlers.onPointerEnter({ pointerType: "mouse" });
  late.clock.fire();
  late.handlers.onPointerLeave();
  expect(late.calls).toEqual(["warm", "open", "cancel"]);
});

test("a second pointer-enter restarts the rest, and a tooltip ignores clicks", () => {
  const { handlers, clock, calls } = setup("hover");
  handlers.onPointerEnter({ pointerType: "mouse" });
  handlers.onPointerEnter({ pointerType: "mouse" });
  expect(clock.waiting()).toBe(1);
  handlers.onClick(click());
  expect(calls).toEqual(["warm", "warm"]);
});

test("a trigger that is removed while the pointer rests on it opens nothing", () => {
  const { handlers, trigger, clock, calls } = setup("hover");
  handlers.onPointerEnter({ pointerType: "mouse" });
  trigger.dispose();
  expect(clock.waiting()).toBe(0);
  clock.fire();
  expect(calls).toEqual(["warm"]);
});

test("a click outside the trigger is not a press of it", () => {
  const { handlers, trigger } = setup("click");
  const element = { contains: (target: unknown) => target === inside };
  const inside = {};
  handlers.onClick(click({ currentTarget: element }));
  expect(trigger.isTrigger(inside)).toBe(true);
  expect(trigger.isTrigger({})).toBe(false);
});

test("a Space that went down on the link and came up after focus left opens nothing", () => {
  const { handlers, calls } = setup("link");
  handlers.onKeyDown(key(" "));
  handlers.onBlur();
  handlers.onKeyUp(key(" "));
  expect(calls).toEqual([]);
});
