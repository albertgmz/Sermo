"use client";

import { type ComponentType, useMemo, useRef, useState } from "react";
import {
  createOpener,
  type Loader,
  loadedCode,
} from "@/components/ui/lazy-popup-gate";
import {
  HOVER_DELAY,
  hovers,
  isPlainClick,
  type OpenedBy,
  type Opening,
  openedByClick,
  opensFromKey,
  spaceOpens,
} from "@/components/ui/lazy-popup-intent";

// A menu, popover, sheet or tooltip whose code (Base UI and the positioning library with it) is
// not part of the page's first load. Until the visitor reaches for it, the page holds a plain
// trigger drawn by the caller with the same look and the same attributes as the real one. The
// first pointer over it, touch or focus fetches the code; the click, key or hover that asks for the
// popup swaps in the real component, which mounts open, so one gesture is enough. A gesture that
// arrives before the code does is kept and the popup opens as soon as the code is there.

// What the plain trigger puts on its element.
export type LazyTriggerProps = {
  onPointerEnter: (event: React.PointerEvent<HTMLElement>) => void;
  onPointerLeave: () => void;
  onPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
  onTouchStart: () => void;
  onFocus: (event: React.FocusEvent<HTMLElement>) => void;
  onClick: (event: React.MouseEvent<HTMLElement>) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void;
  onKeyUp: (event: React.KeyboardEvent<HTMLElement>) => void;
};

// What the real popup is given besides the caller's props.
export type OpenedProps = { openedBy: OpenedBy };

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
  // The code could not be fetched; the trigger stays as it is and asks again next time.
  onLoadError?: () => void;
}) {
  const [shown, setShown] = useState(false);
  const latest = useRef({ onOpen, onLoadError });
  latest.current = { onOpen, onLoadError };
  const openedBy = useRef<OpenedBy>("pointer");
  const pointerType = useRef<string>(undefined);
  const hoverTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const [opener] = useState(() =>
    createOpener(
      load,
      () => {
        setShown(true);
        latest.current.onOpen?.();
      },
      () => latest.current.onLoadError?.(),
    ),
  );

  const handlers = useMemo<LazyTriggerProps>(() => {
    const stopHover = () => clearTimeout(hoverTimer.current);
    return {
      onPointerEnter: (event) => {
        opener.warm();
        if (opening !== "hover" || !hovers(event)) return;
        // The pointer has to rest, as on the real tooltip's trigger.
        stopHover();
        hoverTimer.current = setTimeout(() => {
          openedBy.current = "pointer";
          opener.open();
        }, HOVER_DELAY);
      },
      onPointerLeave: () => {
        if (opening !== "hover") return;
        // A hover that ended before the tooltip came asks for nothing.
        stopHover();
        opener.cancel();
      },
      onPointerDown: (event) => {
        pointerType.current = event.pointerType;
      },
      onTouchStart: opener.warm,
      onFocus: (event) => {
        opener.warm();
        if (
          opening === "hover" &&
          event.currentTarget.matches(":focus-visible")
        ) {
          openedBy.current = "keyboard";
          opener.open();
        }
      },
      onClick: (event) => {
        if (opening === "hover" || !isPlainClick(event)) return;
        event.preventDefault();
        // A press just before this click says how it was made; none, and it was a key.
        openedBy.current = openedByClick(pointerType.current);
        pointerType.current = undefined;
        opener.open();
      },
      onKeyDown: (event) => {
        if (spaceOpens(opening, event.key)) event.preventDefault();
        if (!opensFromKey(opening, event.key)) return;
        event.preventDefault();
        openedBy.current = "keyboard";
        opener.open();
      },
      onKeyUp: (event) => {
        if (!spaceOpens(opening, event.key)) return;
        event.preventDefault();
        openedBy.current = "keyboard";
        opener.open();
      },
    };
  }, [opener, opening]);

  const Loaded = shown ? loadedCode(load) : undefined;
  if (Loaded) return <Loaded {...popup} openedBy={openedBy.current} />;
  return trigger(handlers);
}
