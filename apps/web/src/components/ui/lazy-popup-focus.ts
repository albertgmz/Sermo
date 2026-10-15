import { useLayoutEffect, useRef, useState } from "react";
import type { OpenKey } from "@/components/ui/lazy-popup-handlers";
import { replayOnce } from "@/components/ui/lazy-popup-replay";
import { type OpenedBy, menuOpening } from "@/components/ui/lazy-popup-intent";

// Where focus goes when a sheet or popover that mounted open takes it, matching what Base UI does
// for one the visitor opened by hand: a popup opened by touch takes focus itself, not its first
// field (the keyboard would rise); any other way, Base UI's own choice (the first thing that can
// take focus) stands. `ref` goes on the popup's content.
export function usePopupFocus(openedBy: OpenedBy) {
  const ref = useRef<HTMLDivElement>(null);
  const initialFocus =
    openedBy === "touch" ? () => ref.current ?? true : undefined;
  return { ref, initialFocus };
}

// For a menu: the `defaultOpen` to give it and the ref for its trigger. Opened by a key, the menu
// mounts closed and the key (or the click, for Enter and Space) is replayed on the real trigger, so
// Base UI does what it does for a keyboard open: it focuses the first item, or the last for ArrowUp.
export function useMenuOpening(openedBy: OpenedBy, openKey?: OpenKey) {
  const trigger = useRef<HTMLButtonElement>(null);
  const [{ defaultOpen, replay }] = useState(() =>
    menuOpening(openedBy, openKey),
  );
  const [run] = useState(() => replayOnce());
  useLayoutEffect(() => {
    run(trigger.current, replay);
  }, [run, replay]);
  return { defaultOpen, trigger };
}
