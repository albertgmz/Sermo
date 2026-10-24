import { expect, test } from "bun:test";
import { type IdleWindow, whenIdle } from "./when-idle";

// A window whose page is loading or loaded, with or without `requestIdleCallback`, that runs
// nothing by itself: `fire` runs what it was given.
function fakeWindow(loaded: boolean, idle: boolean) {
  const calls: string[] = [];
  const waiting = new Map<string, () => void>();
  const view: IdleWindow = {
    document: { readyState: loaded ? "complete" : "interactive" },
    addEventListener: (type, run) => {
      calls.push(`listen ${type}`);
      waiting.set(type, run);
    },
    removeEventListener: (type) => {
      calls.push(`forget ${type}`);
      waiting.delete(type);
    },
    setTimeout: (run, delay) => {
      calls.push(`timeout ${delay}`);
      waiting.set("timeout", run);
      return 1;
    },
    clearTimeout: () => {
      calls.push("clear timeout");
      waiting.delete("timeout");
    },
  };
  if (idle) {
    view.requestIdleCallback = (run, options) => {
      calls.push(`idle ${options?.timeout}`);
      waiting.set("idle", run);
      return 2;
    };
    view.cancelIdleCallback = () => {
      calls.push("cancel idle");
      waiting.delete("idle");
    };
  }
  const fire = (what: string) => {
    const run = waiting.get(what);
    waiting.delete(what);
    run?.();
  };
  return { view, calls, fire };
}

test("on a loaded page it runs when the browser is next idle, at the latest after two seconds", () => {
  const { view, calls, fire } = fakeWindow(true, true);
  let ran = 0;
  whenIdle(() => {
    ran += 1;
  }, view);
  expect(calls).toEqual(["idle 2000"]);
  expect(ran).toBe(0);
  fire("idle");
  expect(ran).toBe(1);
});

test("on a page still loading it waits for the page's load, then for the browser to be idle", () => {
  const { view, calls, fire } = fakeWindow(false, true);
  let ran = 0;
  whenIdle(() => {
    ran += 1;
  }, view);
  expect(calls).toEqual(["listen load"]);
  fire("load");
  expect(calls).toEqual(["listen load", "idle 2000"]);
  expect(ran).toBe(0);
  fire("idle");
  expect(ran).toBe(1);
});

test("a browser without requestIdleCallback (Safari) runs it shortly after the page's load", () => {
  const { view, calls, fire } = fakeWindow(false, false);
  let ran = 0;
  whenIdle(() => {
    ran += 1;
  }, view);
  fire("load");
  expect(calls).toEqual(["listen load", "timeout 200"]);
  fire("timeout");
  expect(ran).toBe(1);
});

test("what it answers cancels the wait, at whichever step it is", () => {
  const loading = fakeWindow(false, true);
  whenIdle(() => {}, loading.view)();
  expect(loading.calls).toEqual(["listen load", "forget load"]);

  const idle = fakeWindow(true, true);
  whenIdle(() => {}, idle.view)();
  expect(idle.calls).toEqual(["idle 2000", "cancel idle"]);

  const timer = fakeWindow(true, false);
  whenIdle(() => {}, timer.view)();
  expect(timer.calls).toEqual(["timeout 200", "clear timeout"]);
});
