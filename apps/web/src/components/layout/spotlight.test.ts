import { expect, test } from "bun:test";
import {
  type Box,
  createHistoryScroll,
  createScrollHolder,
  createScrollMemory,
  createScrollRestorer,
  createSpotlight,
  createTraversalGuard,
  decideArrival,
  entryId,
  HOLD_MAX_MS,
  HOLD_QUIET_MS,
  type HoldEnv,
  LANDING_WAIT_MS,
  RESTORE_MS,
  restoresScroll,
  type SpotlightTarget,
  TARGET,
} from "./spotlight";

// Where a landed element's top goes: under a 57 px header, with an 8 px gap.
const LANDING_TOP = 65;

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

// A page that can be scrolled, clicked and waited on by hand. An element sits `at` pixels from the
// top of the document; its box on screen follows the page's scroll.
function fakePage(options: { hash: string; max?: number }) {
  let now = 0;
  const timers: { at: number; run: () => void; live: boolean }[] = [];
  const listeners = new Map<string, Set<() => void>>();
  const jumps: number[] = [];
  const shown: (Box | null)[] = [];
  const present = new Map<string, SpotlightTarget>();
  const frameRuns = new Set<() => void>();
  const page = {
    hash: options.hash,
    y: 0,
    max: options.max ?? 100_000,
    // Where the elements are in the document, and how big.
    at: 1000,
    height: 80,
    loaded: false,
    element(id: string) {
      present.set(id, {
        getBoundingClientRect: () =>
          new RectLike({
            top: page.at - page.y,
            left: 10,
            width: 300,
            height: page.height,
          }),
      });
    },
    // The element's box on screen right now.
    box: (): Box => ({
      top: page.at - page.y,
      left: 10,
      width: 300,
      height: page.height,
    }),
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
    jumps,
    shown,
    get visible() {
      return shown.at(-1) ?? null;
    },
    // Where the element's top is on screen.
    get top() {
      return page.at - page.y;
    },
  };
  const on: HoldEnv["on"] = (type, listener) => {
    const set = listeners.get(type) ?? new Set();
    listeners.set(type, set);
    set.add(listener);
    return () => set.delete(listener);
  };
  const frames: HoldEnv["frames"] = (run) => {
    frameRuns.add(run);
    return () => frameRuns.delete(run);
  };
  const later: HoldEnv["later"] = (run, ms) => {
    const timer = { at: now + ms, run, live: true };
    timers.push(timer);
    return () => {
      timer.live = false;
    };
  };
  const spotlight = createSpotlight({
    hash: () => page.hash,
    find: (id) => present.get(id) ?? null,
    landingTop: () => LANDING_TOP,
    on,
    frames,
    later,
    scroll: {
      scrollY: () => page.y,
      maxScrollY: () => page.max,
      scrollTo: (y) => {
        jumps.push(y);
        page.y = y;
      },
      loaded: () => page.loaded,
      on,
      frames,
      later,
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

test("the page lands at once with the element's top under the header, and dims around it", () => {
  const { page, spotlight } = fakePage({ hash: "#post-12" });
  page.element("post-12");
  spotlight.start();
  // One instant jump, no smooth scroll to wait for.
  expect(page.jumps).toEqual([1000 - LANDING_TOP]);
  expect(page.top).toBe(LANDING_TOP);
  expect(page.visible).toEqual(page.box());
});

test("the element is held under the header while pictures and late sections above it load", () => {
  const { page, spotlight } = fakePage({ hash: "#profile-post-3" });
  page.element("profile-post-3");
  spotlight.start();
  // A picture above grows from nothing; a notice arrives above the content.
  page.at = 1400;
  page.frame();
  expect(page.top).toBe(LANDING_TOP);
  page.at = 1450;
  page.wait(1000);
  page.frame();
  expect(page.top).toBe(LANDING_TOP);
  // The browser's own jump to the fragment is put back too.
  page.y = 0;
  page.frame();
  expect(page.top).toBe(LANDING_TOP);
});

test("the reader's first action lets go: the page stays where the reader takes it", () => {
  for (const type of ["pointerdown", "keydown", "touchstart", "wheel"]) {
    const { page, spotlight } = fakePage({ hash: "#message-4" });
    page.element("message-4");
    spotlight.start();
    page.fire(type);
    expect(page.visible).toBeNull();
    expect(page.framing()).toBe(0);
    page.y = 200;
    page.at = 1300;
    page.frame();
    expect(page.y).toBe(200);
    for (const listened of ["pointerdown", "keydown", "touchstart", "wheel"])
      expect(page.listening(listened)).toBe(0);
  }
});

test("a scroll the page makes itself does not let go", () => {
  const { page, spotlight } = fakePage({ hash: "#post-12" });
  page.element("post-12");
  spotlight.start();
  page.fire("scroll");
  page.at = 1200;
  page.frame();
  expect(page.top).toBe(LANDING_TOP);
  expect(page.visible).not.toBeNull();
});

test("the holding ends once the page has loaded and stayed still, and at the latest after a while", () => {
  const settled = fakePage({ hash: "#post-12" });
  settled.page.element("post-12");
  settled.spotlight.start();
  // Still loading: held however still the page is.
  settled.page.wait(HOLD_QUIET_MS * 3);
  expect(settled.page.framing()).toBeGreaterThan(0);
  settled.page.loaded = true;
  settled.page.wait(HOLD_QUIET_MS * 2);
  settled.page.at = 1500;
  settled.page.frame();
  expect(settled.page.top).toBe(1500 - (1000 - LANDING_TOP));

  const busy = fakePage({ hash: "#post-12" });
  busy.page.element("post-12");
  busy.spotlight.start();
  busy.page.loaded = true;
  // Something keeps moving it: held until the cap.
  for (let waited = 0; waited < HOLD_MAX_MS - 500; waited += 500) {
    busy.page.at += 10;
    busy.page.frame();
    busy.page.wait(500);
  }
  busy.page.at += 10;
  busy.page.frame();
  expect(busy.page.top).toBe(LANDING_TOP);
  busy.page.wait(1000);
  busy.page.at += 100;
  busy.page.frame();
  expect(busy.page.top).toBe(LANDING_TOP + 100);
});

test("a page still too short is followed as far as it reaches", () => {
  const { page, spotlight } = fakePage({ hash: "#post-12", max: 500 });
  page.element("post-12");
  spotlight.start();
  expect(page.y).toBe(500);
  page.max = 5000;
  page.frame();
  expect(page.top).toBe(LANDING_TOP);
});

test("the dimming goes away by itself after a few seconds", () => {
  const { page, spotlight } = fakePage({ hash: "#profile-comment-9" });
  page.element("profile-comment-9");
  spotlight.start();
  page.wait(3500);
  expect(page.visible).not.toBeNull();
  page.wait(1000);
  expect(page.visible).toBeNull();
});

test("an element that streams in is waited for, a long while but not forever, and not past the reader's action", () => {
  const late = fakePage({ hash: "#post-12" });
  late.spotlight.start();
  late.page.wait(LANDING_WAIT_MS - 1000);
  expect(late.page.jumps).toEqual([]);
  late.page.element("post-12");
  late.page.wait(200);
  expect(late.page.top).toBe(LANDING_TOP);

  const never = fakePage({ hash: "#post-99" });
  never.spotlight.start();
  never.page.wait(LANDING_WAIT_MS + 1000);
  never.page.element("post-99");
  never.page.wait(1000);
  expect(never.page.jumps).toEqual([]);
  expect(never.page.shown).toEqual([]);

  const scrolled = fakePage({ hash: "#post-12" });
  scrolled.spotlight.start();
  scrolled.page.wait(500);
  scrolled.page.fire("wheel");
  scrolled.page.element("post-12");
  scrolled.page.wait(1000);
  expect(scrolled.page.jumps).toEqual([]);
});

test("a navigation from another page shows the new page from its top while the element streams in", () => {
  const { page, spotlight } = fakePage({ hash: "#post-12" });
  page.y = 3000; // where the reader was on the page they left
  spotlight.start({ fromTop: true });
  expect(page.jumps).toEqual([0]);
  page.element("post-12");
  page.wait(200);
  expect(page.top).toBe(LANDING_TOP);

  // Drawn already: straight to it.
  const drawn = fakePage({ hash: "#post-12" });
  drawn.page.element("post-12");
  drawn.page.y = 3000;
  drawn.spotlight.start({ fromTop: true });
  expect(drawn.page.jumps).toEqual([1000 - LANDING_TOP]);
});

test("an address that names nothing known does nothing", () => {
  const { page, spotlight } = fakePage({ hash: "#main" });
  page.element("main");
  spotlight.start({ fromTop: true });
  page.wait(1000);
  expect(page.jumps).toEqual([]);
  expect(page.shown).toEqual([]);
});

test("a new address replaces the one before it", () => {
  const { page, spotlight } = fakePage({ hash: "#post-1" });
  page.element("post-1");
  spotlight.start();
  expect(page.visible).not.toBeNull();
  page.hash = "#post-2";
  spotlight.start();
  expect(page.visible).toBeNull();
  page.at = 2000;
  page.element("post-2");
  page.wait(200);
  expect(page.top).toBe(LANDING_TOP);
  expect(page.framing()).toBe(2); // one hold, one dimming
});

test("a link to the same page lands once the address has changed", () => {
  const { page, spotlight } = fakePage({ hash: "" });
  page.element("post-5");
  spotlight.startWhenHashIs("#post-5");
  page.wait(120);
  expect(page.jumps).toEqual([]);
  page.hash = "#post-5";
  page.wait(400);
  expect(page.top).toBe(LANDING_TOP);
  expect(page.visible).not.toBeNull();

  // An address that never changes gives up.
  const stuck = fakePage({ hash: "" });
  stuck.page.element("post-5");
  stuck.spotlight.startWhenHashIs("#post-5");
  stuck.page.wait(5000);
  expect(stuck.page.jumps).toEqual([]);
});

test("stopping removes everything it listened to and lets go of the page", () => {
  const { page, spotlight } = fakePage({ hash: "#post-12" });
  page.element("post-12");
  spotlight.start();
  spotlight.stop();
  expect(page.visible).toBeNull();
  expect(page.framing()).toBe(0);
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
  const pending: { run: () => void; ms: number; timer: { live: boolean } }[] =
    [];
  const later = (run: () => void, ms: number) => {
    const timer = { live: true };
    pending.push({ run, ms, timer });
    return () => {
      timer.live = false;
    };
  };
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
});

test("the dimming stays on the element when content shifts while it is shown", () => {
  const { page, spotlight } = fakePage({ hash: "#post-12" });
  page.element("post-12");
  spotlight.start();
  const first = page.box();
  expect(page.visible).toEqual(first);
  page.frame();
  expect(page.shown).toEqual([first]);
  // The element grows (a picture inside it loads): the dimming follows.
  page.height = 200;
  page.frame();
  expect(page.visible).toEqual(page.box());
  expect(page.shown).toHaveLength(2);
  // Once dismissed it measures nothing more.
  page.fire("pointerdown");
  expect(page.framing()).toBe(0);
});

test("the dimming is given plain numbers, not the rectangle the browser returned", () => {
  const { page, spotlight } = fakePage({ hash: "#post-12" });
  page.element("post-12");
  spotlight.start();
  const shown = page.visible;
  expect(Object.keys(shown ?? {}).sort()).toEqual([
    "height",
    "left",
    "top",
    "width",
  ]);
  expect(shown).not.toBeInstanceOf(RectLike);
});

test("a second hold replaces the first", () => {
  const scroller = fakeScroller({ y: 0, max: 5000 });
  const holder = createScrollHolder(scroller.env);
  holder.hold(() => 100, { forMs: 1000 });
  holder.hold(() => 300, { quietMs: 500 });
  expect(scroller.page.framing()).toBe(1);
  expect(scroller.page.y).toBe(300);
});

test("an arrival starts once per history entry", () => {
  const handled = new Set<string>();
  const hash = "#post-42";
  const decide = (key: string | undefined, navigationType?: string, h = hash) =>
    decideArrival({ key, hash: h, handled, navigationType });
  // First arrival by a link or by typing.
  expect(decide("k1", "navigate")).toBe("start");
  handled.add(entryId("k1", hash));
  // Back or Forward to the same entry, or the router re-running effects on it.
  expect(decide("k1")).toBe("skip");
  // A new navigation to the same address is a new entry.
  expect(decide("k2")).toBe("start");
  // A same-document link to a post is a new entry with another hash.
  expect(decide("k1", undefined, "#post-43")).toBe("start");
  // A reload or a document-level visit by history never starts.
  expect(decide("k3", "reload")).toBe("skip");
  expect(decide("k3", "back_forward")).toBe("skip");
  // An address that names nothing never starts.
  expect(decide("k4", "navigate", "#top")).toBe("skip");
  expect(decide("k4", "navigate", "")).toBe("skip");
  // Without entry keys the traversal guard decides.
  expect(decide(undefined, "navigate")).toBe("guard");
  expect(decide(undefined, "reload")).toBe("skip");
});

// A page whose scroll position something else can move, and whose length can change.
function fakeScroller(options: { y: number; max: number }) {
  let now = 0;
  const frames = new Set<() => void>();
  const timers: { at: number; run: () => void; live: boolean }[] = [];
  const listeners = new Map<string, Set<() => void>>();
  const jumps: number[] = [];
  const page = {
    y: options.y,
    max: options.max,
    frame() {
      for (const run of [...frames]) run();
    },
    framing: () => frames.size,
    fire(type: string) {
      for (const listener of [...(listeners.get(type) ?? [])]) listener();
    },
    tick(ms: number) {
      now += ms;
      for (const timer of timers)
        if (timer.live && timer.at <= now) {
          timer.live = false;
          timer.run();
        }
    },
    jumps,
  };
  const env: HoldEnv = {
    scrollY: () => page.y,
    maxScrollY: () => page.max,
    loaded: () => true,
    scrollTo: (y) => {
      jumps.push(y);
      page.y = y;
    },
    on: (type, listener) => {
      const set = listeners.get(type) ?? new Set();
      listeners.set(type, set.add(listener));
      return () => set.delete(listener);
    },
    frames: (run) => {
      frames.add(run);
      return () => frames.delete(run);
    },
    later: (run, ms) => {
      const timer = { at: now + ms, run, live: true };
      timers.push(timer);
      return () => {
        timer.live = false;
      };
    },
  };
  return { page, env };
}

test("the position is kept only for entries whose arrival was handled", () => {
  const handled = new Set([entryId("a", "#post-1")]);
  const memory = createScrollMemory(handled);
  memory.leave(entryId("a", "#post-1"), 0);
  memory.leave(entryId("b", "#post-1"), 300);
  expect(memory.recall(entryId("a", "#post-1"))).toBe(0);
  expect(memory.recall(entryId("b", "#post-1"))).toBeUndefined();
  memory.leave(entryId("a", "#post-1"), 40);
  expect(memory.recall(entryId("a", "#post-1"))).toBe(40);
});

test("a jump to the address after the restore is put back where the reader left", () => {
  const { page, env } = fakeScroller({ y: 0, max: 5000 });
  const restorer = createScrollRestorer(env);
  restorer.restore(0);
  page.frame();
  expect(page.jumps).toEqual([]);
  page.y = 1200; // the jump to #post-N
  page.frame();
  expect(page.y).toBe(0);
  page.y = 16;
  page.frame();
  expect(page.y).toBe(0);
});

test("a page still too short is followed as far as it reaches, then the position is reached", () => {
  const { page, env } = fakeScroller({ y: 0, max: 100 });
  createScrollRestorer(env).restore(900);
  page.frame();
  expect(page.y).toBe(100);
  page.max = 4000;
  page.frame();
  expect(page.y).toBe(900);
});

test("the reader's first action ends the holding", () => {
  for (const type of ["pointerdown", "keydown", "wheel", "touchstart"]) {
    const { page, env } = fakeScroller({ y: 0, max: 5000 });
    createScrollRestorer(env).restore(0);
    page.fire(type);
    expect(page.framing()).toBe(0);
    page.y = 700;
    page.frame();
    expect(page.y).toBe(700);
  }
});

test("the holding ends by itself after a moment and leaves nothing listening", () => {
  const { page, env } = fakeScroller({ y: 0, max: 5000 });
  createScrollRestorer(env).restore(0);
  page.tick(RESTORE_MS - 1);
  expect(page.framing()).toBe(1);
  page.tick(1);
  expect(page.framing()).toBe(0);
  page.y = 50;
  page.frame();
  expect(page.y).toBe(50);
});

test("a second restore replaces the first", () => {
  const { page, env } = fakeScroller({ y: 0, max: 5000 });
  const restorer = createScrollRestorer(env);
  restorer.restore(100);
  restorer.restore(300);
  expect(page.framing()).toBe(1);
  page.frame();
  expect(page.y).toBe(300);
});

// The entry bookkeeping around a traversal, with the browser faked.
function fakeHistory(start: { key: string; hash: string; y: number }) {
  const state = { ...start };
  const handled = new Set<string>();
  const restored: number[] = [];
  const scroll = createHistoryScroll({
    key: () => state.key,
    hash: () => state.hash,
    scrollY: () => state.y,
    handled,
    restore: (y) => restored.push(y),
  });
  return { state, handled, restored, scroll };
}

test("an entry with a target is saved under its own key when it is left, and put back on return", () => {
  const h = fakeHistory({ key: "a", hash: "#post-45", y: 0 });
  h.handled.add(entryId("a", "#post-45"));
  h.scroll.onNavigate("push");
  // the new entry
  h.state.key = "b";
  h.state.hash = "";
  h.state.y = 900;
  h.scroll.onNavigate("traverse");
  // Back to the first
  h.state.key = "a";
  h.state.hash = "#post-45";
  h.state.y = 16;
  h.scroll.revisit();
  expect(h.restored).toEqual([0]);
});

test("a replacement of the entry is not leaving it", () => {
  const h = fakeHistory({ key: "a", hash: "#post-45", y: 0 });
  h.handled.add(entryId("a", "#post-45"));
  h.scroll.onNavigate("push");
  h.state.y = 16; // the jump
  h.scroll.onNavigate("replace");
  h.scroll.revisit();
  expect(h.restored).toEqual([0]);
});

test("entries whose address names no target are left to the browser", () => {
  const h = fakeHistory({ key: "a", hash: "", y: 300 });
  h.handled.add(entryId("a", ""));
  h.scroll.onNavigate("push");
  h.scroll.revisit();
  h.state.hash = "#top";
  h.handled.add(entryId("a", "#top"));
  h.scroll.onNavigate("push");
  h.scroll.revisit();
  expect(h.restored).toEqual([]);
});

test("an entry not yet handled, or without a saved position, restores nothing", () => {
  const h = fakeHistory({ key: "a", hash: "#post-45", y: 5 });
  h.scroll.onNavigate("push");
  h.scroll.revisit();
  h.handled.add(entryId("a", "#post-45"));
  h.scroll.revisit();
  expect(h.restored).toEqual([]);
});

test("without an entry key nothing is kept", () => {
  const h = fakeHistory({ key: "a", hash: "#post-45", y: 5 });
  const none = createHistoryScroll({
    key: () => undefined,
    hash: () => "#post-45",
    scrollY: () => 5,
    handled: h.handled,
    restore: (y) => h.restored.push(y),
  });
  none.onNavigate("push");
  none.revisit();
  expect(h.restored).toEqual([]);
});
