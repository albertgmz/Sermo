import { expect, test } from "bun:test";
import {
  type PollEnv,
  type PollOutcome,
  pollDelay,
  startPolling,
} from "@/lib/polling";

// A clock, timers and signals that a test moves by hand.
function fakeEnv() {
  let now = 0;
  let visible = true;
  let nextId = 1;
  const timers = new Map<number, { at: number; run: () => void }>();
  const visibility = new Set<() => void>();
  const activity = new Set<() => void>();
  const env: PollEnv = {
    now: () => now,
    setTimer: (run, ms) => {
      const id = nextId++;
      timers.set(id, { at: now + ms, run });
      return id;
    },
    clearTimer: (handle) => {
      timers.delete(handle as number);
    },
    visible: () => visible,
    onVisibility: (listener) => {
      visibility.add(listener);
      return () => visibility.delete(listener);
    },
    onActivity: (listener) => {
      activity.add(listener);
      return () => activity.delete(listener);
    },
  };
  return {
    env,
    // Moves time forward, running each timer on its way, and lets the answers settle.
    async advance(ms: number) {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      const end = now + ms;
      for (;;) {
        const due = [...timers.entries()]
          .filter(([, timer]) => timer.at <= end)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        now = Math.max(now, due[1].at);
        due[1].run();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      }
      now = end;
    },
    hide() {
      visible = false;
      for (const listener of [...visibility]) listener();
    },
    show() {
      visible = true;
      for (const listener of [...visibility]) listener();
    },
    touch() {
      for (const listener of [...activity]) listener();
    },
    pending: () => timers.size,
    listeners: () => visibility.size + activity.size,
  };
}

function counted(outcomes: (PollOutcome | Error)[] = []) {
  let calls = 0;
  const run = async () => {
    const outcome = outcomes[calls] ?? undefined;
    calls += 1;
    if (outcome instanceof Error) throw outcome;
    return outcome;
  };
  return { run, calls: () => calls };
}

test("polls once per interval, the first one an interval after the start", async () => {
  const clock = fakeEnv();
  const poll = counted();
  startPolling(poll.run, { intervalMs: 3000 }, clock.env);
  await clock.advance(2999);
  expect(poll.calls()).toBe(0);
  await clock.advance(1);
  expect(poll.calls()).toBe(1);
  await clock.advance(9000);
  expect(poll.calls()).toBe(4);
});

test("a tab that is hidden is not polled, and polls again when it is shown", async () => {
  const clock = fakeEnv();
  const poll = counted();
  startPolling(poll.run, { intervalMs: 3000 }, clock.env);
  await clock.advance(3000);
  expect(poll.calls()).toBe(1);
  clock.hide();
  expect(clock.pending()).toBe(0);
  await clock.advance(60_000);
  expect(poll.calls()).toBe(1);
  clock.show();
  await clock.advance(0);
  expect(poll.calls()).toBe(2);
  await clock.advance(3000);
  expect(poll.calls()).toBe(3);
});

test("a tab shown again soon after a poll waits out the rest of the interval", async () => {
  const clock = fakeEnv();
  const poll = counted();
  startPolling(poll.run, { intervalMs: 3000 }, clock.env);
  await clock.advance(3000);
  clock.hide();
  await clock.advance(500);
  clock.show();
  await clock.advance(2000);
  expect(poll.calls()).toBe(1);
  await clock.advance(500);
  expect(poll.calls()).toBe(2);
});

test("failures double the wait up to the limit and a success brings it back", async () => {
  const options = { intervalMs: 3000, maxIntervalMs: 60_000 };
  expect([0, 1, 2, 3, 4, 5, 6, 40].map((n) => pollDelay(n, options))).toEqual([
    3000, 6000, 12_000, 24_000, 48_000, 60_000, 60_000, 60_000,
  ]);
  const clock = fakeEnv();
  const boom = new Error("backend");
  const poll = counted([boom, boom, boom]);
  startPolling(poll.run, options, clock.env);
  await clock.advance(3000);
  expect(poll.calls()).toBe(1);
  await clock.advance(5999);
  expect(poll.calls()).toBe(1);
  await clock.advance(1);
  expect(poll.calls()).toBe(2);
  await clock.advance(12_000);
  expect(poll.calls()).toBe(3);
  // The fourth poll succeeds; the one after it is an interval away again.
  await clock.advance(24_000);
  expect(poll.calls()).toBe(4);
  await clock.advance(3000);
  expect(poll.calls()).toBe(5);
});

test("an interval longer than the limit is never shortened by it", () => {
  expect(pollDelay(3, { intervalMs: 90_000 })).toBe(90_000);
  expect(pollDelay(0, { intervalMs: 60_000 })).toBe(60_000);
});

test("polling stops for a visitor who has done nothing for long, and starts at their next move", async () => {
  const clock = fakeEnv();
  const poll = counted();
  startPolling(poll.run, { intervalMs: 3000, idleStopMs: 60_000 }, clock.env);
  await clock.advance(59_000);
  const before = poll.calls();
  expect(before).toBeGreaterThan(10);
  await clock.advance(10_000);
  const stopped = poll.calls();
  expect(stopped).toBeLessThanOrEqual(before + 2);
  await clock.advance(120_000);
  expect(poll.calls()).toBe(stopped);
  clock.touch();
  await clock.advance(0);
  expect(poll.calls()).toBe(stopped + 1);
  await clock.advance(3000);
  expect(poll.calls()).toBe(stopped + 2);
});

test("a visitor who keeps moving is never taken for idle", async () => {
  const clock = fakeEnv();
  const poll = counted();
  startPolling(poll.run, { intervalMs: 3000, idleStopMs: 60_000 }, clock.env);
  for (let minute = 0; minute < 5; minute++) {
    await clock.advance(30_000);
    clock.touch();
  }
  expect(poll.calls()).toBe(50);
});

test("a poll that says stop ends polling", async () => {
  const clock = fakeEnv();
  const poll = counted([undefined, "stop"]);
  startPolling(poll.run, { intervalMs: 3000 }, clock.env);
  await clock.advance(30_000);
  expect(poll.calls()).toBe(2);
  expect(clock.pending()).toBe(0);
});

test("a poll still running is not overlapped", async () => {
  const clock = fakeEnv();
  let started = 0;
  let finish = () => {};
  startPolling(
    () => {
      started += 1;
      return new Promise<void>((done) => {
        finish = done;
      });
    },
    { intervalMs: 3000 },
    clock.env,
  );
  await clock.advance(30_000);
  expect(started).toBe(1);
  finish();
  await clock.advance(3000);
  expect(started).toBe(2);
});

test("ending it removes the timer and the listeners", async () => {
  const clock = fakeEnv();
  const poll = counted();
  const end = startPolling(poll.run, { intervalMs: 3000 }, clock.env);
  expect(clock.listeners()).toBe(2);
  end();
  expect(clock.pending()).toBe(0);
  expect(clock.listeners()).toBe(0);
  await clock.advance(30_000);
  expect(poll.calls()).toBe(0);
});
