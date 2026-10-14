import { expect, test } from "bun:test";
import {
  type Box,
  createSpotlight,
  type SpotlightTarget,
  TARGET,
} from "./spotlight";

const BOX: Box = { top: 100, left: 10, width: 300, height: 80 };

// A page that can be scrolled, clicked and waited on by hand.
function fakePage(options: { hash: string; reduced?: boolean }) {
  let now = 0;
  const timers: { at: number; run: () => void; live: boolean }[] = [];
  const listeners = new Map<string, Set<() => void>>();
  const scrolls: { block: string; behavior: string }[] = [];
  const shown: (Box | null)[] = [];
  const present = new Map<string, SpotlightTarget>();
  const page = {
    hash: options.hash,
    element(id: string) {
      present.set(id, {
        getBoundingClientRect: () => BOX,
        scrollIntoView: (to) => scrolls.push(to),
      });
    },
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
