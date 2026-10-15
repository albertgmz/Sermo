import { expect, test } from "bun:test";
import { createOpener, fetchCode, loadedCode } from "./lazy-popup-gate";

function deferred() {
  let resolve!: (value: { default: string }) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<{ default: string }>((ok, no) => {
    resolve = ok;
    reject = no;
  });
  return { promise, resolve, reject };
}

const tick = () => new Promise((done) => setTimeout(done, 0));

function recorder(load: () => Promise<{ default: string }>, slot?: string) {
  const seen = { shown: 0, failed: 0, busy: [] as boolean[] };
  const opener = createOpener(load, {
    slot,
    show: () => seen.shown++,
    fail: () => seen.failed++,
    busy: (value) => seen.busy.push(value),
  });
  return { opener, seen };
}

test("the code is fetched once however many triggers ask, and warming opens nothing", async () => {
  let fetched = 0;
  const load = async () => {
    fetched += 1;
    return { default: "popup" };
  };
  const a = recorder(load);
  const b = recorder(load);
  a.opener.warm();
  b.opener.warm();
  a.opener.warm();
  await tick();
  expect(fetched).toBe(1);
  expect(a.seen.shown + b.seen.shown).toBe(0);
  expect(loadedCode(load)).toBe("popup");
});

test("a press before the code arrives is busy until it does, then opens; one after opens at once", async () => {
  const slow = deferred();
  const { opener, seen } = recorder(() => slow.promise);
  opener.open();
  expect(seen.shown).toBe(0);
  expect(opener.pending).toBe(true);
  expect(seen.busy).toEqual([true]);
  slow.resolve({ default: "popup" });
  await tick();
  expect(seen.shown).toBe(1);
  expect(opener.pending).toBe(false);
  expect(seen.busy).toEqual([true, false]);
  opener.open();
  expect(seen.shown).toBe(2);
});

test("a withdrawn press opens nothing when the code arrives", async () => {
  const slow = deferred();
  const { opener, seen } = recorder(() => slow.promise);
  opener.open();
  opener.cancel();
  expect(seen.busy).toEqual([true, false]);
  slow.resolve({ default: "popup" });
  await tick();
  expect(seen.shown).toBe(0);
});

test("a second press on the same trigger while it waits does not ask twice", async () => {
  const slow = deferred();
  const { opener, seen } = recorder(() => slow.promise);
  opener.open();
  opener.open();
  slow.resolve({ default: "popup" });
  await tick();
  expect(seen.shown).toBe(1);
});

test("only one press of a kind waits at a time: a press elsewhere takes the place of the first", async () => {
  const slow = deferred();
  const first = recorder(() => slow.promise, "press");
  const second = recorder(() => slow.promise, "press");
  first.opener.open();
  second.opener.open();
  expect(first.opener.pending).toBe(false);
  expect(first.seen.busy).toEqual([true, false]);
  slow.resolve({ default: "popup" });
  await tick();
  expect([first.seen.shown, second.seen.shown]).toEqual([0, 1]);
});

test("a hover does not displace a press that waits, and presses of other kinds coexist", async () => {
  const slow = deferred();
  const press = recorder(() => slow.promise, "press");
  const hover = recorder(() => slow.promise, "hover");
  press.opener.open();
  hover.opener.open();
  slow.resolve({ default: "popup" });
  await tick();
  expect([press.seen.shown, hover.seen.shown]).toEqual([1, 1]);
});

test("a fetch that fails once is tried again, and opens if the second works", async () => {
  let attempts = 0;
  const load = async () => {
    attempts += 1;
    if (attempts === 1) throw new Error("dropped");
    return { default: "popup" };
  };
  const { opener, seen } = recorder(load);
  opener.open();
  await tick();
  expect([attempts, seen.shown, seen.failed]).toEqual([2, 1, 0]);
});

test("a fetch that fails twice is reported once, forgotten, and tried again by the next press", async () => {
  let attempts = 0;
  const load = async () => {
    attempts += 1;
    if (attempts <= 2) throw new Error("stale chunk");
    return { default: "popup" };
  };
  const { opener, seen } = recorder(load);
  opener.open();
  await tick();
  expect([attempts, seen.shown, seen.failed]).toEqual([2, 0, 1]);
  expect(seen.busy).toEqual([true, false]);
  expect(loadedCode(load)).toBeUndefined();
  opener.open();
  await tick();
  expect([attempts, seen.shown, seen.failed]).toEqual([3, 1, 1]);
  await fetchCode(load);
});

test("a withdrawn press is not reported when the fetch then fails", async () => {
  const slow = deferred();
  const { opener, seen } = recorder(() => slow.promise);
  opener.open();
  opener.cancel();
  slow.reject(new Error("offline"));
  await tick();
  expect(seen.failed).toBe(0);
});
