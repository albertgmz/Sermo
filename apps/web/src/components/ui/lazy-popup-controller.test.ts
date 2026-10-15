import { expect, test } from "bun:test";
import {
  type ControllerCallbacks,
  type ControllerEnv,
  createController,
} from "./lazy-popup-controller";
import type { Opening } from "./lazy-popup-intent";
import type { Recovery } from "./lazy-popup-recovery";

// `LazyPopup` is this controller drawn by a component: the behaviour is tested here, with a stand-in
// for the document and for the recovery.

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

function fakeEnv(recovery: Recovery = "reloaded") {
  const listeners = new Map<string, Set<(event: never) => void>>();
  const log = { recovered: 0 };
  const env: ControllerEnv = {
    listen: (type, run) => {
      const set = listeners.get(type) ?? new Set();
      set.add(run);
      listeners.set(type, set);
    },
    unlisten: (type, run) => {
      listeners.get(type)?.delete(run);
    },
    recover: () => {
      log.recovered += 1;
      return recovery;
    },
    loaded: () => {},
  };
  const count = () =>
    [...listeners.values()].reduce((sum, set) => sum + set.size, 0);
  const emit = (type: string, event: object) => {
    for (const run of [...(listeners.get(type) ?? [])]) run(event as never);
  };
  return { env, log, count, emit };
}

const click = () => ({
  button: 0,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  preventDefault: () => {},
});

function make(
  load: () => Promise<{ default: string }>,
  options: {
    opening?: Opening;
    recovery?: Recovery;
    callbacks?: ControllerCallbacks;
  } = {},
) {
  const world = fakeEnv(options.recovery);
  const controller = createController(
    load,
    options.opening ?? "click",
    world.env,
    () => options.callbacks ?? {},
  );
  return { controller, ...world };
}

test("a press shows the popup as soon as its code is there, and tells the parent", async () => {
  const slow = deferred();
  let opened = 0;
  const { controller } = make(() => slow.promise, {
    callbacks: { onOpen: () => opened++ },
  });
  controller.handlers.onClick(click());
  expect(controller.getState()).toEqual({
    shown: false,
    busy: true,
    notice: false,
  });
  slow.resolve({ default: "popup" });
  await tick();
  expect(controller.getState()).toEqual({
    shown: true,
    busy: false,
    notice: false,
  });
  expect(opened).toBe(1);
});

test("subscribers hear every change, and stop hearing when they leave", async () => {
  const slow = deferred();
  const { controller } = make(() => slow.promise);
  let heard = 0;
  const leave = controller.subscribe(() => heard++);
  controller.handlers.onClick(click());
  expect(heard).toBe(1);
  leave();
  slow.resolve({ default: "popup" });
  await tick();
  expect(heard).toBe(1);
});

test("while a press waits, Escape and a press away from the trigger withdraw it, and a press on it does not", async () => {
  const slow = deferred();
  const inside = {};
  const { controller, emit, count } = make(() => slow.promise);
  controller.handlers.onClick({
    ...click(),
    currentTarget: { contains: (target: unknown) => target === inside },
  } as never);
  expect(count()).toBe(2);

  emit("pointerdown", { target: inside });
  expect(controller.getState().busy).toBe(true);
  emit("keydown", { key: "a" });
  expect(controller.getState().busy).toBe(true);

  emit("pointerdown", { target: {} });
  expect(controller.getState().busy).toBe(false);
  expect(count()).toBe(0);
  slow.resolve({ default: "popup" });
  await tick();
  expect(controller.getState().shown).toBe(false);

  const again = make(() => deferred().promise);
  again.controller.handlers.onClick(click());
  again.emit("keydown", { key: "Escape" });
  expect(again.controller.getState().busy).toBe(false);
  expect(again.count()).toBe(0);
});

test("the listeners are gone when the popup arrives, when the trigger is removed, and are never doubled", async () => {
  const slow = deferred();
  const arrived = make(() => slow.promise);
  arrived.controller.handlers.onClick(click());
  expect(arrived.count()).toBe(2);
  slow.resolve({ default: "popup" });
  await tick();
  expect(arrived.count()).toBe(0);

  const removed = make(() => deferred().promise);
  removed.controller.handlers.onClick(click());
  removed.controller.dispose();
  removed.controller.dispose();
  expect(removed.count()).toBe(0);
  expect(removed.controller.getState().busy).toBe(false);
});

test("a tooltip waiting for its code is not announced as busy and listens to nothing", () => {
  const { controller, count } = make(() => deferred().promise, {
    opening: "hover",
  });
  controller.handlers.onPointerEnter({ pointerType: "mouse" });
  expect(controller.getState().busy).toBe(false);
  expect(count()).toBe(0);
});

test("a code that cannot be fetched reloads the page once, and says nothing when it did", async () => {
  const { controller, log } = make(async () => {
    throw new Error("stale chunk");
  });
  controller.handlers.onClick(click());
  await tick();
  expect(log.recovered).toBe(1);
  expect(controller.getState()).toEqual({
    shown: false,
    busy: false,
    notice: false,
  });
});

test("when the reload is not an option the visitor is told, and the notice can be dismissed", async () => {
  const { controller, log } = make(
    async () => {
      throw new Error("blocked");
    },
    { recovery: "gave-up" },
  );
  controller.handlers.onClick(click());
  await tick();
  expect(log.recovered).toBe(1);
  expect(controller.getState().notice).toBe(true);
  controller.dismissNotice();
  expect(controller.getState().notice).toBe(false);
});

test("a trigger that is a link says where to go instead, and does not reload or show the notice", async () => {
  let gone = 0;
  const { controller, log } = make(
    async () => {
      throw new Error("blocked");
    },
    { recovery: "gave-up", callbacks: { onLoadError: () => gone++ } },
  );
  controller.handlers.onClick(click());
  await tick();
  expect([gone, log.recovered, controller.getState().notice]).toEqual([
    1,
    0,
    false,
  ]);
});

test("a tooltip that cannot load stays as it is: no reload, no notice", async () => {
  const { controller, log } = make(
    async () => {
      throw new Error("blocked");
    },
    { opening: "hover", recovery: "gave-up" },
  );
  controller.handlers.onPointerEnter({ pointerType: "mouse" });
  controller.dispose();
  expect(log.recovered).toBe(0);
  expect(controller.getState().notice).toBe(false);
});

test("a key press on a trigger whose code is already there withdraws another trigger's waiting press", async () => {
  const warm = async () => ({ default: "phone menu" });
  const slow = deferred();
  const first = make(() => slow.promise);
  const second = make(warm);
  second.controller.handlers.onFocus();
  await tick();

  first.controller.handlers.onKeyDown({
    key: "Enter",
    preventDefault: () => {},
  });
  first.controller.handlers.onClick(click());
  expect(first.controller.getState().busy).toBe(true);

  second.controller.handlers.onClick(click());
  expect(second.controller.getState().shown).toBe(true);
  expect(first.controller.getState().busy).toBe(false);

  slow.resolve({ default: "user menu" });
  await tick();
  expect(first.controller.getState().shown).toBe(false);
});
