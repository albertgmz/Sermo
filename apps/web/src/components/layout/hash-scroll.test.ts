import { expect, test } from "bun:test";
import { type ScrollEnv, scrollToHash } from "./hash-scroll";

// A page whose element appears after `appearsAt` ms; time moves when the test runs the timers.
function page(
  hash: string,
  appearsAt: number,
  load: { type?: string; traversal?: boolean } = {},
) {
  let now = 0;
  const timers: { at: number; run: () => void }[] = [];
  const listeners = new Map<string, () => void>();
  const scrolled: string[] = [];
  const env: ScrollEnv = {
    hash: () => hash,
    find: (id) =>
      now >= appearsAt && id === "appearance"
        ? { scrollIntoView: () => scrolled.push(id) }
        : null,
    navigationType: () => load.type,
    traversal: () => load.traversal ?? false,
    on: (type, listener) => {
      listeners.set(type, listener);
      return () => listeners.delete(type);
    },
    later: (run, ms) => {
      const timer = { at: now + ms, run };
      timers.push(timer);
      return () => timers.splice(timers.indexOf(timer), 1);
    },
  };
  const advance = (ms: number) => {
    const until = now + ms;
    while (timers.length && Math.min(...timers.map((t) => t.at)) <= until) {
      const next = timers.reduce((a, b) => (b.at < a.at ? b : a));
      timers.splice(timers.indexOf(next), 1);
      now = next.at;
      next.run();
    }
    now = until;
  };
  return { env, advance, scrolled, listeners };
}

test("an element on the page is scrolled to at once", () => {
  const { env, scrolled } = page("#appearance", 0);
  scrollToHash(env);
  expect(scrolled).toEqual(["appearance"]);
});

test("an element that streams in later is scrolled to when it appears", () => {
  const { env, advance, scrolled } = page("#appearance", 1200);
  scrollToHash(env);
  expect(scrolled).toEqual([]);
  advance(1300);
  expect(scrolled).toEqual(["appearance"]);
});

test("it gives up when the element never comes, and when there is no hash", () => {
  const late = page("#appearance", 10_000);
  scrollToHash(late.env);
  late.advance(5000);
  expect(late.scrolled).toEqual([]);
  const none = page("", 0);
  scrollToHash(none.env);
  expect(none.scrolled).toEqual([]);
});

test("cancelling stops the wait", () => {
  const { env, advance, scrolled } = page("#appearance", 500);
  scrollToHash(env)();
  advance(1000);
  expect(scrolled).toEqual([]);
});

test("an address that does not decode is used as written, or ignored", () => {
  const { env, scrolled } = page("#%E0%A4%A", 0);
  expect(() => scrollToHash(env)).not.toThrow();
  expect(scrolled).toEqual([]);
  const { env: encoded, scrolled: found } = page("#appear%61nce", 0);
  scrollToHash(encoded);
  expect(found).toEqual(["appearance"]);
});

test("a reload, Back and Forward keep the position the browser restores", () => {
  for (const load of [
    { type: "reload" },
    { type: "back_forward" },
    { traversal: true },
  ]) {
    const { env, advance, scrolled } = page("#appearance", 0, load);
    scrollToHash(env);
    advance(1000);
    expect(scrolled).toEqual([]);
  }
  const { env, scrolled } = page("#appearance", 0, { type: "navigate" });
  scrollToHash(env);
  expect(scrolled).toEqual(["appearance"]);
});

test("the wait ends when the reader scrolls, touches or types", () => {
  for (const type of ["wheel", "touchstart", "keydown", "pointerdown"]) {
    const { env, advance, scrolled, listeners } = page("#appearance", 1200);
    scrollToHash(env);
    advance(500);
    listeners.get(type)?.();
    advance(2000);
    expect(scrolled).toEqual([]);
  }
});
