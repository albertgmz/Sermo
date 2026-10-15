"use client";

import { type ComponentType, useMemo, useRef, useState } from "react";
import {
  createOpener,
  type Loader,
  loadedCode,
} from "@/components/ui/lazy-popup-gate";
import {
  hovers,
  isPlainClick,
  type Opening,
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
  onTouchStart: () => void;
  onFocus: (event: React.FocusEvent<HTMLElement>) => void;
  onClick: (event: React.MouseEvent<HTMLElement>) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void;
  onKeyUp: (event: React.KeyboardEvent<HTMLElement>) => void;
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
  // `popup` and mounts open.
  load: Loader<ComponentType<P>>;
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

  const handlers = useMemo<LazyTriggerProps>(() => {
    const opener = createOpener(
      load,
      () => {
        setShown(true);
        latest.current.onOpen?.();
      },
      () => latest.current.onLoadError?.(),
    );
    return {
      onPointerEnter: (event) => {
        opener.warm();
        if (opening === "hover" && hovers(event)) opener.open();
      },
      // A hover that ended before the code came asks for nothing.
      onPointerLeave: () => {
        if (opening === "hover") opener.cancel();
      },
      onTouchStart: opener.warm,
      onFocus: (event) => {
        opener.warm();
        if (
          opening === "hover" &&
          event.currentTarget.matches(":focus-visible")
        )
          opener.open();
      },
      onClick: (event) => {
        if (opening === "hover" || !isPlainClick(event)) return;
        event.preventDefault();
        opener.open();
      },
      onKeyDown: (event) => {
        if (spaceOpens(opening, event.key)) event.preventDefault();
        if (!opensFromKey(opening, event.key)) return;
        event.preventDefault();
        opener.open();
      },
      onKeyUp: (event) => {
        if (!spaceOpens(opening, event.key)) return;
        event.preventDefault();
        opener.open();
      },
    };
  }, [load, opening]);

  const Loaded = shown ? loadedCode(load) : undefined;
  if (Loaded) return <Loaded {...popup} />;
  return trigger(handlers);
}
