import { useEffect, useRef } from "react";

// What a poll answers: nothing in particular, or that polling is over (the session ended, the
// thing polled is gone), which stops it until the screen starts it again.
// biome-ignore lint/suspicious/noConfusingVoidType: a poll that returns nothing is a Promise<void>
export type PollOutcome = void | "stop";

export type PollOptions = {
  // The wait between two polls while they succeed.
  intervalMs: number;
  // A failed poll doubles the wait, up to this (never below `intervalMs`).
  maxIntervalMs?: number;
  // Polling stops when the visitor has done nothing for this long, and starts again at once with
  // their next move.
  idleStopMs?: number;
};

// One tab's polls stay few: they pause while the tab is hidden, back off while the backend fails
// and stop for a visitor who has left the tab open and walked away.
export const POLL_MAX_INTERVAL_MS = 60_000;
export const POLL_IDLE_STOP_MS = 10 * 60_000;

// The clock, the timers and the signals the browser gives, so that a test can drive them.
export type PollEnv = {
  now: () => number;
  setTimer: (run: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
  visible: () => boolean;
  onVisibility: (listener: () => void) => () => void;
  onActivity: (listener: () => void) => () => void;
};

const ACTIVITY_EVENTS = [
  "pointerdown",
  "pointermove",
  "keydown",
  "scroll",
  "touchstart",
  "wheel",
] as const;

export const browserEnv: PollEnv = {
  now: () => Date.now(),
  setTimer: (run, ms) => setTimeout(run, ms),
  clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  visible: () => document.visibilityState === "visible",
  onVisibility: (listener) => {
    document.addEventListener("visibilitychange", listener);
    return () => document.removeEventListener("visibilitychange", listener);
  },
  onActivity: (listener) => {
    for (const name of ACTIVITY_EVENTS) {
      window.addEventListener(name, listener, { passive: true });
    }
    return () => {
      for (const name of ACTIVITY_EVENTS) {
        window.removeEventListener(name, listener);
      }
    };
  },
};

// The wait after `failures` failed polls in a row.
export function pollDelay(
  failures: number,
  { intervalMs, maxIntervalMs = POLL_MAX_INTERVAL_MS }: PollOptions,
) {
  return Math.min(
    intervalMs * 2 ** Math.min(failures, 16),
    Math.max(maxIntervalMs, intervalMs),
  );
}

// Calls `run` every `intervalMs` while the tab is visible and the visitor is about; returns the
// function that ends it. The first poll comes one interval after the start (the screen has just
// been drawn). A poll still running is never overlapped by the next.
export function startPolling(
  run: () => Promise<PollOutcome>,
  options: PollOptions,
  env: PollEnv = browserEnv,
) {
  const { intervalMs, idleStopMs = POLL_IDLE_STOP_MS } = options;
  let timer: unknown;
  let failures = 0;
  let running = false;
  let ended = false;
  let idle = false;
  let lastStart = env.now();
  let lastActivity = env.now();

  const clear = () => {
    if (timer !== undefined) env.clearTimer(timer);
    timer = undefined;
  };
  const schedule = (ms: number) => {
    clear();
    if (ended || idle || running || !env.visible()) return;
    timer = env.setTimer(tick, ms);
  };
  async function tick() {
    timer = undefined;
    if (ended || running || !env.visible()) return;
    if (env.now() - lastActivity >= idleStopMs) {
      idle = true;
      return;
    }
    running = true;
    lastStart = env.now();
    try {
      if ((await run()) === "stop") ended = true;
      failures = 0;
    } catch {
      failures += 1;
    } finally {
      running = false;
    }
    schedule(pollDelay(failures, options));
  }
  // Back in view, or the visitor is back: the next poll is due when it would have been.
  const resume = () => {
    if (running) return;
    schedule(Math.max(0, lastStart + pollDelay(failures, options) - env.now()));
  };

  const offVisibility = env.onVisibility(() => {
    if (env.visible()) resume();
    else clear();
  });
  const offActivity = env.onActivity(() => {
    lastActivity = env.now();
    if (idle) {
      idle = false;
      resume();
    }
  });
  schedule(intervalMs);

  return () => {
    ended = true;
    clear();
    offVisibility();
    offActivity();
  };
}

// Polls while the component is mounted and `enabled`; `run` is always the latest closure.
export function usePolling(
  run: () => Promise<PollOutcome>,
  options: PollOptions & { enabled?: boolean },
) {
  const latest = useRef(run);
  latest.current = run;
  const { intervalMs, maxIntervalMs, idleStopMs, enabled = true } = options;
  useEffect(() => {
    if (!enabled) return;
    return startPolling(() => latest.current(), {
      intervalMs,
      maxIntervalMs,
      idleStopMs,
    });
  }, [enabled, intervalMs, maxIntervalMs, idleStopMs]);
}
