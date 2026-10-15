"use client";

import { type ComponentType, useEffect, useRef, useState } from "react";
import {
  createOpener,
  type Loader,
  loadedCode,
} from "@/components/ui/lazy-popup-gate";
import {
  createTrigger,
  type OpenKey,
} from "@/components/ui/lazy-popup-handlers";
import type { OpenedBy, Opening } from "@/components/ui/lazy-popup-intent";

// A menu, popover, sheet or tooltip whose code (Base UI and the positioning library with it) is
// not part of the page's first load. Until the visitor reaches for it, the page holds a plain
// trigger drawn by the caller with the same look and the same attributes as the real one. The
// first pointer over it, touch or focus fetches the code; the click, key or hover that asks for the
// popup swaps in the real component, which mounts open, so one gesture is enough. A gesture that
// arrives before the code does is kept, shown on the trigger as busy, and withdrawn by a second
// press, Escape or a press elsewhere. A code that cannot be fetched (twice) reloads the page.

// What the plain trigger puts on its element: the handlers take the real events, which carry more
// than they read.
export type LazyTriggerProps = {
  onPointerEnter: (event: React.PointerEvent<HTMLElement>) => void;
  onPointerLeave: () => void;
  onPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
  onPointerCancel: () => void;
  onTouchStart: () => void;
  onFocus: () => void;
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
  // The code could not be fetched, twice. Without it a press reloads the page (a tooltip, which is
  // no button, stays as it is).
  onLoadError?: () => void;
}) {
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const latest = useRef({ onOpen, onLoadError });
  latest.current = { onOpen, onLoadError };

  const [made] = useState(() => {
    const opener = createOpener(load, {
      slot: opening === "hover" ? "hover" : "press",
      busy: setBusy,
      show: () => {
        setShown(true);
        latest.current.onOpen?.();
      },
      fail: () => {
        if (latest.current.onLoadError) latest.current.onLoadError();
        else if (opening !== "hover")
          window.location.assign(window.location.href);
      },
    });
    return { opener, ...createTrigger(opener, opening) };
  });

  // The trigger is gone: nothing is left resting or waiting.
  useEffect(
    () => () => {
      made.dispose();
      made.opener.cancel();
    },
    [made],
  );

  // While the popup is on its way, Escape or a press anywhere but on the trigger withdraws it.
  useEffect(() => {
    if (!busy) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") made.opener.cancel();
    };
    const away = (event: PointerEvent) => {
      if (!made.isTrigger(event.target)) made.opener.cancel();
    };
    document.addEventListener("keydown", escape);
    document.addEventListener("pointerdown", away);
    return () => {
      document.removeEventListener("keydown", escape);
      document.removeEventListener("pointerdown", away);
    };
  }, [busy, made]);

  const Loaded = shown ? loadedCode(load) : undefined;
  if (Loaded) return <Loaded {...popup} {...made.gesture()} />;
  const { handlers } = made;
  return trigger(
    busy ? { ...handlers, "aria-busy": true, "data-loading": "" } : handlers,
  );
}
