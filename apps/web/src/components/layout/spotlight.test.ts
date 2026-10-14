import { expect, test } from "bun:test";
import {
  type Box,
  createSpotlight,
  createTraversalGuard,
  restoresScroll,
  type SpotlightTarget,
  startsOnMount,
  TARGET,
} from "./spotlight";

const BOX: Box = { top: 100, left: 10, width: 300, height: 80 };

// Like a real DOMRect: the fields are getters on the prototype, so spreading it gives {}.
class RectLike implements Box {
  #box: Box;
  constructor(box: Box) {
    this.#box = box;
  }
  get top() {
    return this.#box.top;
  }
  get left() {
    return this.#box.left;
  }
  get width() {
    return this.#box.width;
  }
  get height() {
    return this.#box.height;
  }
}

// A page that can be scrolled, clicked and waited on by hand.
function fakePage(options: { hash: string; reduced?: boolean }) {
  let now = 0;
  const timers: { at: number; run: () => void; live: boolean }[] = [];
  const listeners = new Map<string, Set<() => void>>();
  const scrolls: { block: string; behavior: string }[] = [];
  const shown: (Box | null)[] = [];
  const present = new Map<string, SpotlightTarget>();
  const frameRuns = new Set<() => void>();
  const page = {
    hash: options.hash,
    box: BOX,
    element(id: string) {
      present.set(id, {
        getBoundingClientRect: () => new RectLike(page.box),
        scrollIntoView: (to) => scrolls.push(to),
      });
    },
    frame() {
      for (const run of [...frameRuns]) run();
    },
    framing: () => frameRuns.size,
    fire(type: string) {
      for (const listener of [...(listeners.get(type) ?? [])]) listener();
    },
    listening: (type: string) => listeners.get(type)?.size ?? 0,
    wait(ms: number) {
      const end = now + ms;
      while (true) {
        const next = timers
          .filter((timer) => timer.live && timer.at <= end)
          .sort((a, b) => a.at - b.at)[0];
        if (!next) break;
        next.live = false;
        now = next.at;
        next.run();
      }
      now = end;
    },
    scrolls,
    shown,
    get visible() {
      return shown.at(-1) ?? null;
    },
  };
  const spotlight = createSpotlight({
    hash: () => page.hash,
    find: (id) => present.get(id) ?? null,
    reducedMotion: () => options.reduced ?? false,
    on: (type, listener) => {
      const set = listeners.get(type) ?? new Set();
      listeners.set(type, set);
      set.add(listener);
      return () => set.delete(listener);
    },
    frames: (run) => {
      frameRuns.add(run);
      return () => frameRuns.delete(run);
    },
    later: (run, ms) => {
      const timer = { at: now + ms, run, live: true };
      timers.push(timer);
      return () => {
        timer.live = false;
      };
    },
    show: (box) => shown.push(box),
    hide: () => {
      if (shown.at(-1)) shown.push(null);
    },
  });
  return { page, spotlight };
}

test("only the elements a notification can name are targets", () => {
  for (const hash of [
    "#post-12",
    "#profile-post-3",
    "#profile-comment-9",
    "#message-4",
  ]) {
    expect(TARGET.test(hash)).toBe(true);
  }
  for (const hash of [
    "",
    "#",
    "#post-",
    "#post-1x",
    "#main",
    "#profile-post-3-comment",
  ]) {
    expect(TARGET.test(hash)).toBe(false);
  }
});

test("the element is scrolled into view smoothly and the page is dimmed once the scroll ends", () => {
  const { page, spotlight } = fakePage({ hash: "#post-12" });
  page.element("post-12");
  spotlight.start();
  expect(page.scrolls).toEqual([{ block: "center", behavior: "smooth" }]);
  expect(page.visible).toBeNull();
  // The scroll the element's arrival causes keeps the dimming back until it has ended.
  page.wait(100);
  page.fire("scroll");
  page.wait(100);
  page.fire("scroll");
  page.wait(100);
  expect(page.visible).toBeNull();
  page.wait(100);
  expect(page.visible).toEqual(BOX);
});

test("a scroll after that removes the dimming at once", () => {
  const { page, spotlight } = fakePage({ hash: "#message-4" });
  page.element("message-4");
  spotlight.start();
  page.wait(200);
  expect(page.visible).toEqual(BOX);
  page.fire("scroll");
  expect(page.visible).toBeNull();
  expect(page.listening("scroll")).toBe(0);
});

test("a click, a key press, a touch and a wheel turn remove it at once, even before it is shown", () => {
  for (const type of ["pointerdown", "keydown", "touchstart", "wheel"]) {
    const { page, spotlight } = fakePage({ hash: "#profile-post-3" });
    page.element("profile-post-3");
    spotlight.start();
    page.wait(200);
    expect(page.visible).toEqual(BOX);
    page.fire(type);
    expect(page.visible).toBeNull();
    expect(page.listening(type)).toBe(0);

    const early = fakePage({ hash: "#profile-post-3" });
    early.page.element("profile-post-3");
    early.spotlight.start();
    early.page.fire(type);
    early.page.wait(1000);
    expect(early.page.shown).toEqual([]);
  }
});

test("it goes away by itself after a few seconds", () => {
  const { page, spotlight } = fakePage({ hash: "#profile-comment-9" });
  page.element("profile-comment-9");
  spotlight.start();
  page.wait(200);
  expect(page.visible).toEqual(BOX);
  page.wait(3500);
  expect(page.visible).toEqual(BOX);
  page.wait(1000);
  expect(page.visible).toBeNull();
});

test("with reduced motion the scroll is not animated", () => {
  const { page, spotlight } = fakePage({ hash: "#post-12", reduced: true });
  page.element("post-12");
  spotlight.start();
  expect(page.scrolls).toEqual([{ block: "center", behavior: "auto" }]);
  page.wait(200);
  expect(page.visible).toEqual(BOX);
});

test("an element that streams in after the page loads is waited for, but not forever", () => {
  const late = fakePage({ hash: "#post-12" });
  late.spotlight.start();
  late.page.wait(1500);
  expect(late.page.scrolls).toEqual([]);
  late.page.element("post-12");
  late.page.wait(200);
  expect(late.page.scrolls).toHaveLength(1);
  late.page.wait(300);
  expect(late.page.visible).toEqual(BOX);

  const never = fakePage({ hash: "#post-99" });
  never.spotlight.start();
  never.page.wait(10000);
  expect(never.page.scrolls).toEqual([]);
  expect(never.page.shown).toEqual([]);
});

test("an address that names nothing known does nothing", () => {
  const { page, spotlight } = fakePage({ hash: "#main" });
  page.element("main");
  spotlight.start();
  page.wait(1000);
  expect(page.scrolls).toEqual([]);
  expect(page.shown).toEqual([]);
});

test("a new address replaces the one before it", () => {
  const { page, spotlight } = fakePage({ hash: "#post-1" });
  page.element("post-1");
  page.element("post-2");
  spotlight.start();
  page.wait(200);
  expect(page.visible).toEqual(BOX);
  page.hash = "#post-2";
  spotlight.start();
  expect(page.visible).toBeNull();
  page.wait(200);
  expect(page.visible).toEqual(BOX);
  expect(page.scrolls).toHaveLength(2);
});

test("a link to the same page starts once the address has changed", () => {
  const { page, spotlight } = fakePage({ hash: "" });
  page.element("post-5");
  spotlight.startWhenHashIs("#post-5");
  page.wait(120);
  expect(page.scrolls).toEqual([]);
  page.hash = "#post-5";
  page.wait(400);
  expect(page.scrolls).toHaveLength(1);
  expect(page.visible).toEqual(BOX);

  // An address that never changes gives up.
  const stuck = fakePage({ hash: "" });
  stuck.page.element("post-5");
  stuck.spotlight.startWhenHashIs("#post-5");
  stuck.page.wait(5000);
  expect(stuck.page.scrolls).toEqual([]);
});

test("stopping removes everything it listened to", () => {
  const { page, spotlight } = fakePage({ hash: "#post-12" });
  page.element("post-12");
  spotlight.start();
  page.wait(200);
  spotlight.stop();
  expect(page.visible).toBeNull();
  for (const type of [
    "scroll",
    "resize",
    "pointerdown",
    "keydown",
    "wheel",
    "touchstart",
  ]) {
    expect(page.listening(type)).toBe(0);
  }
});

test("a reload and a visit by history are left to the browser's own scroll", () => {
  expect(restoresScroll("reload")).toBe(true);
  expect(restoresScroll("back_forward")).toBe(true);
  for (const type of ["navigate", "prerender", undefined]) {
    expect(restoresScroll(type)).toBe(false);
  }
});

test("a traversal is taken by the first change that follows it, once", () => {
  const { page } = fakePage({ hash: "" });
  const later = (run: () => void, ms: number) => {
    const timer = { live: true };
    // Same clock as the fake page: the page's own timers are not exposed, so use its wait.
    pending.push({ run, ms, timer });
    return () => {
      timer.live = false;
    };
  };
  const pending: { run: () => void; ms: number; timer: { live: boolean } }[] =
    [];
  const guard = createTraversalGuard(later);
  expect(guard.consume()).toBe(false);
  guard.traversal();
  // Every effect of the commit that follows gets the same answer...
  expect(guard.consume()).toBe(true);
  expect(guard.consume()).toBe(true);
  // ...and the mark is gone by the next task.
  for (const item of pending) if (item.timer.live && item.ms === 0) item.run();
  expect(guard.consume()).toBe(false);
  // A link followed after the traversal is a new navigation.
  guard.traversal();
  guard.reset();
  expect(guard.consume()).toBe(false);
  // A traversal that no change follows is forgotten.
  guard.traversal();
  for (const item of pending) if (item.timer.live) item.run();
  expect(guard.consume()).toBe(false);
  expect(page.shown).toEqual([]);
});

test("the dimming stays on the element when content shifts while it is shown", () => {
  const { page, spotlight } = fakePage({ hash: "#post-12" });
  page.element("post-12");
  spotlight.start();
  page.frame();
  expect(page.shown).toEqual([]);
  page.wait(200);
  expect(page.visible).toEqual(BOX);
  page.frame();
  expect(page.shown).toEqual([BOX]);
  const moved = { ...BOX, top: 240, height: 120 };
  page.box = moved;
  page.frame();
  expect(page.visible).toEqual(moved);
  page.frame();
  expect(page.shown).toEqual([BOX, moved]);
  // Once dismissed it measures nothing more.
  page.fire("pointerdown");
  expect(page.framing()).toBe(0);
});

test("the dimming is given plain numbers, not the rectangle the browser returned", () => {
  const { page, spotlight } = fakePage({ hash: "#post-12" });
  page.element("post-12");
  spotlight.start();
  page.wait(200);
  const shown = page.visible;
  expect(shown).toEqual(BOX);
  expect(Object.keys(shown ?? {}).sort()).toEqual([
    "height",
    "left",
    "top",
    "width",
  ]);
  expect(shown).not.toBeInstanceOf(RectLike);
  // Content shifting moves it the same way.
  page.box = { ...BOX, top: 40 };
  page.frame();
  expect(page.visible).toEqual({ ...BOX, top: 40 });
});

test("a component mounted again by a client-side Back does not start", () => {
  const pending: { run: () => void; ms: number; live: boolean }[] = [];
  const guard = createTraversalGuard((run, ms) => {
    const item = { run, ms, live: true };
    pending.push(item);
    return () => {
      item.live = false;
    };
  });
  // A plain arrival by a link: the document's entry says navigate.
  expect(startsOnMount("navigate", guard)).toBe(true);
  // popstate, then the component is mounted again (or shown again) while the document's entry
  // still says navigate: its mount effect and its path effect both see the traversal.
  guard.traversal();
  expect(startsOnMount("navigate", guard)).toBe(false);
  expect(guard.consume()).toBe(true);
  for (const item of pending) if (item.live && item.ms === 0) item.run();
  // The next arrival is new again.
  expect(startsOnMount("navigate", guard)).toBe(true);
  // A reload or a document-level history visit never starts, with or without a mark.
  expect(startsOnMount("reload", guard)).toBe(false);
  expect(startsOnMount("back_forward", guard)).toBe(false);
});
