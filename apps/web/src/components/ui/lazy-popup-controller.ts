import { createOpener, type Loader } from "@/components/ui/lazy-popup-gate";
import { createTrigger } from "@/components/ui/lazy-popup-handlers";
import type { Opening } from "@/components/ui/lazy-popup-intent";
import type { Recovery } from "@/components/ui/lazy-popup-recovery";

// Everything `LazyPopup` does apart from drawing: the state of one plain trigger (is the real popup
// shown, is the press waiting for it, did the code fail for good), the listeners that withdraw a
// waiting press, and the recovery from a failed fetch. The component only subscribes to it, so it
// can be tested without a browser by handing it a stand-in `env`.

export type ControllerState = {
  // The real popup replaces the plain trigger.
  shown: boolean;
  // A press is waiting for the popup's code.
  busy: boolean;
  // The code could not be fetched and a reload was not an option: the visitor is told.
  notice: boolean;
};

export type ControllerEnv = {
  listen: (
    type: "keydown" | "pointerdown",
    run: (event: never) => void,
  ) => void;
  unlisten: (
    type: "keydown" | "pointerdown",
    run: (event: never) => void,
  ) => void;
  recover: () => Recovery;
  // The popup's code arrived.
  loaded: () => void;
};

export type ControllerCallbacks = {
  onOpen?: () => void;
  onLoadError?: () => void;
};

export function createController<C>(
  load: Loader<C>,
  opening: Opening,
  env: ControllerEnv,
  callbacks: () => ControllerCallbacks,
) {
  let state: ControllerState = { shown: false, busy: false, notice: false };
  const listeners = new Set<() => void>();
  const set = (next: Partial<ControllerState>) => {
    state = { ...state, ...next };
    for (const run of listeners) run();
  };

  const escape = (event: { key: string }) => {
    if (event.key === "Escape") opener.cancel();
  };
  const away = (event: { target: unknown }) => {
    if (!trigger.isTrigger(event.target)) opener.cancel();
  };
  let listening = false;
  const watch = (on: boolean) => {
    if (on === listening) return;
    listening = on;
    const act = on ? env.listen : env.unlisten;
    act("keydown", escape as (event: never) => void);
    act("pointerdown", away as (event: never) => void);
  };

  const opener = createOpener(load, {
    slot: opening === "hover" ? "hover" : "press",
    // A tooltip is no button: nothing is announced or shown while it waits.
    busy:
      opening === "hover"
        ? undefined
        : (busy) => {
            watch(busy);
            set({ busy });
          },
    show: () => {
      env.loaded();
      set({ shown: true });
      callbacks().onOpen?.();
    },
    fail: () => {
      const { onLoadError } = callbacks();
      if (onLoadError) onLoadError();
      else if (opening !== "hover" && env.recover() === "gave-up")
        set({ notice: true });
    },
  });
  const trigger = createTrigger(opener, opening);

  return {
    getState: () => state,
    subscribe: (run: () => void) => {
      listeners.add(run);
      return () => {
        listeners.delete(run);
      };
    },
    handlers: trigger.handlers,
    gesture: trigger.gesture,
    dismissNotice: () => {
      if (state.notice) set({ notice: false });
    },
    // The trigger is gone: nothing is left resting or waiting.
    dispose: () => {
      trigger.dispose();
      opener.cancel();
      watch(false);
    },
  };
}
