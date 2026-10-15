"use client";

import {
  type ComponentType,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  type ControllerEnv,
  createController,
} from "@/components/ui/lazy-popup-controller";
import { type Loader, loadedCode } from "@/components/ui/lazy-popup-gate";
import type { OpenKey } from "@/components/ui/lazy-popup-handlers";
import type { OpenedBy, Opening } from "@/components/ui/lazy-popup-intent";
import { LazyPopupNotice } from "@/components/ui/lazy-popup-notice";
import {
  browserRecoveryEnv,
  forgetReload,
  recoverFromChunkFailure,
} from "@/components/ui/lazy-popup-recovery";

// A menu, popover, sheet or tooltip whose code (Base UI and the positioning library with it) is
// not part of the page's first load. Until the visitor reaches for it, the page holds a plain
// trigger drawn by the caller with the same look and the same attributes as the real one. The
// first pointer over it, touch or focus fetches the code; the click, key or hover that asks for the
// popup swaps in the real component, which mounts open, so one gesture is enough. A gesture that
// arrives before the code does is kept, shown on the trigger as busy, and withdrawn by a second
// press, Escape or a press elsewhere. A code that cannot be fetched (twice) reloads the page, once
// per address per session; after that the visitor is told to reload it. The behaviour is in
// `lazy-popup-controller.ts`; this draws it.

// What the plain trigger puts on its element: the handlers take the real events, which carry more
// than they read.
export type LazyTriggerProps = {
  onPointerEnter: (event: React.PointerEvent<HTMLElement>) => void;
  onPointerLeave: () => void;
  onPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
  onPointerCancel: () => void;
  onTouchStart: () => void;
  onFocus: () => void;
  onBlur: () => void;
  onClick: (event: React.MouseEvent<HTMLElement>) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void;
  onKeyUp: (event: React.KeyboardEvent<HTMLElement>) => void;
  // Set while the popup is on its way.
  "aria-busy"?: true;
  "data-loading"?: "";
};

// What the real popup is given besides the caller's props.
export type OpenedProps = {
  openedBy: OpenedBy;
  // The arrow key that opened a menu.
  openKey?: OpenKey;
};

const NOTICE_MS = 8000;

const browserEnv: ControllerEnv = {
  listen: (type, run) =>
    document.addEventListener(type, run as (event: Event) => void),
  unlisten: (type, run) =>
    document.removeEventListener(type, run as (event: Event) => void),
  recover: () => recoverFromChunkFailure(browserRecoveryEnv),
  loaded: () => forgetReload(browserRecoveryEnv),
};

export function LazyPopup<P extends object>({
  load,
  popup,
  trigger,
  opening = "click",
  onOpen,
  onLoadError,
}: {
  // `() => import("./the-popup")`, a function that lives at module level (the code is fetched once
  // per function). The module's default export is the real popup, trigger included: it receives
  // `popup` and `openedBy`, and mounts open.
  load: Loader<ComponentType<P & OpenedProps>>;
  popup: P;
  // The plain trigger, given the handlers to spread on its element.
  trigger: (lazy: LazyTriggerProps) => React.ReactElement;
  opening?: Opening;
  // The popup is being swapped in to open, for a parent that keeps the open state itself.
  onOpen?: () => void;
  // The code could not be fetched, twice. Without it a press reloads the page once, then tells the
  // visitor (a tooltip, which is no button, stays as it is). A trigger that is a link says where
  // to go instead.
  onLoadError?: () => void;
}) {
  const latest = useRef({ onOpen, onLoadError });
  latest.current = { onOpen, onLoadError };
  const [controller] = useState(() =>
    createController(load, opening, browserEnv, () => latest.current),
  );
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getState,
    controller.getState,
  );

  // The trigger is gone: nothing is left resting or waiting.
  useEffect(() => () => controller.dispose(), [controller]);

  // The notice goes by itself.
  useEffect(() => {
    if (!state.notice) return;
    const timer = setTimeout(controller.dismissNotice, NOTICE_MS);
    return () => clearTimeout(timer);
  }, [state.notice, controller]);

  const Loaded = state.shown ? loadedCode(load) : undefined;
  if (Loaded) return <Loaded {...popup} {...controller.gesture()} />;
  const { handlers } = controller;
  return (
    <>
      {trigger(
        state.busy
          ? { ...handlers, "aria-busy": true, "data-loading": "" }
          : handlers,
      )}
      {state.notice && <LazyPopupNotice />}
    </>
  );
}
