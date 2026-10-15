import { useRef } from "react";
import type { OpenedBy } from "@/components/ui/lazy-popup-intent";

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
