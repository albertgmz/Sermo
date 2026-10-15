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

// The event handlers of a plain trigger, as a plain function so they can be tested with fake events.
// They fetch the code on the first pointer, touch or focus, and ask for the popup on the gesture
// that opens it (see `Opening`); what began the gesture is kept for the popup, which needs it to
// choose where focus goes.

type Target = { currentTarget?: EventTarget | null };
type Prevent = Target & { preventDefault(): void };
type Click = Prevent & {
  button: number;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
};
type Key = Prevent & { key: string };

export type TriggerHandlers = {
  onPointerEnter: (event: Target & { pointerType?: string }) => void;
  onPointerLeave: () => void;
  onPointerDown: (event: Target & { pointerType?: string }) => void;
  onPointerCancel: () => void;
  onTouchStart: () => void;
  onFocus: () => void;
  onBlur: () => void;
  onClick: (event: Click) => void;
  onKeyDown: (event: Key) => void;
  onKeyUp: (event: Key) => void;
};

export type Opener = {
  warm(): void;
  open(): void;
  cancel(): void;
  readonly pending: boolean;
};

export type Timers<T = unknown> = {
  set: (run: () => void, ms: number) => T;
  clear: (timer: T) => void;
};

// The arrow keys that open a menu, which the real trigger then handles as it would have: the first
// item for ArrowDown, the last for ArrowUp.
export type OpenKey = "ArrowDown" | "ArrowUp";

export function createTrigger<T = unknown>(
  opener: Opener,
  opening: Opening,
  timers: Timers<T> = {
    set: setTimeout as unknown as Timers<T>["set"],
    clear: clearTimeout as unknown as Timers<T>["clear"],
  },
) {
  let openedBy: OpenedBy = "pointer";
  let openKey: OpenKey | undefined;
  let pointerType: string | undefined;
  let spaceDown = false;
  let hover: T | undefined;
  let hasHover = false;
  // The element the last gesture was made on: a press anywhere else is not a press of this trigger.
  let element: EventTarget | null = null;
  const on = (event: Target) => {
    element = event.currentTarget ?? element;
  };

  const stopHover = () => {
    if (hasHover) timers.clear(hover as T);
    hasHover = false;
  };
  const open = (by: OpenedBy, key?: OpenKey) => {
    openedBy = by;
    openKey = key;
    opener.open();
  };

  const handlers: TriggerHandlers = {
    onPointerEnter: (event) => {
      on(event);
      opener.warm();
      if (opening !== "hover" || !hovers(event)) return;
      // The pointer has to rest, as on the real tooltip's trigger.
      stopHover();
      hasHover = true;
      hover = timers.set(() => {
        hasHover = false;
        open("pointer");
      }, HOVER_DELAY);
    },
    onPointerLeave: () => {
      if (opening !== "hover") return;
      // A hover that ended before the tooltip came asks for nothing.
      stopHover();
      opener.cancel();
    },
    onPointerDown: (event) => {
      on(event);
      pointerType = event.pointerType;
    },
    // A press that became a scroll or a drag never clicks: forget it.
    onPointerCancel: () => {
      pointerType = undefined;
    },
    onTouchStart: () => opener.warm(),
    onFocus: () => opener.warm(),
    // A Space that went down here and came up after focus left is not a press of this link.
    onBlur: () => {
      spaceDown = false;
    },
    onClick: (event) => {
      on(event);
      if (opening === "hover" || !isPlainClick(event)) return;
      event.preventDefault();
      const by = openedByClick(pointerType);
      pointerType = undefined;
      // Pressing again while the popup is on its way withdraws the wish.
      if (opener.pending) opener.cancel();
      else open(by);
    },
    onKeyDown: (event) => {
      on(event);
      pointerType = undefined;
      if (event.key === "Escape") opener.cancel();
      if (spaceOpens(opening, event.key)) {
        event.preventDefault();
        spaceDown = true;
      }
      if (!opensFromKey(opening, event.key)) return;
      event.preventDefault();
      open("keyboard", event.key as OpenKey);
    },
    onKeyUp: (event) => {
      if (!spaceOpens(opening, event.key)) return;
      // A Space that went down somewhere else is not a press of this link.
      if (!spaceDown) return;
      spaceDown = false;
      event.preventDefault();
      open("keyboard");
    },
  };

  return {
    handlers,
    // What began the gesture that is opening the popup.
    gesture: () => ({ openedBy, openKey }),
    // Whether an event target is the trigger the gestures were made on.
    isTrigger: (target: unknown) =>
      (element as Node | null)?.contains(target as Node) ?? false,
    // The trigger is gone: a hover that was resting asks for nothing.
    dispose: stopHover,
  };
}
