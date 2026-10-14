import { expect, test } from "bun:test";
import { type ScrollEnv, scrollToHash } from "./hash-scroll";

// A page whose element appears after `appearsAt` ms; time moves when the test runs the timers.
function page(hash: string, appearsAt: number) {
  let now = 0;
  const timers: { at: number; run: () => void }[] = [];
  const scrolled: string[] = [];
  const env: ScrollEnv = {
    hash: () => hash,
    find: (id) =>
      now >= appearsAt && id === "appearance"
        ? { scrollIntoView: () => scrolled.push(id) }
        : null,
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
  return { env, advance, scrolled };
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
