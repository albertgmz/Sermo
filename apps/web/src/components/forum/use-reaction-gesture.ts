"use client";

import {
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  distanceToRects,
  type GestureEffect,
  type GestureEvent,
  type Hit,
  HOLD_MS,
  idleGesture,
  reduceGesture,
} from "@/components/forum/reaction-gesture";

// A touch stays captured by the button it started on, so the reaction under the finger is found
// from its position: each reaction in the picker carries `data-reaction-id`.
const REACTION_SELECTOR = "[data-reaction-id]";

function vibrate() {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) {
    navigator.vibrate(10);
  }
}

// Carries the reaction button's pointer events through the gesture machine and carries out its
// effects. While the finger slides, the page does not scroll and no text is selected.
export function useReactionGesture({
  button,
  picker,
  given,
  open,
  close,
  choose,
}: {
  button: RefObject<HTMLButtonElement | null>;
  picker: RefObject<HTMLElement | null>;
  given: number | null;
  open: () => void;
  close: () => void;
  choose: (typeId: number | null) => void;
}) {
  const state = useRef(idleGesture);
  const holdTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const swallow = useRef(false);
  const touch = useRef(false);
  const [hover, setHover] = useState<number | null>(null);
  const [sliding, setSliding] = useState(false);
  // The callbacks change every render; the machine's effects use the latest.
  const latest = useRef({ open, close, choose });
  latest.current = { open, close, choose };

  const dispatch = useCallback((event: GestureEvent) => {
    const step = reduceGesture(state.current, event);
    state.current = step.state;
    setHover(step.state.hover);
    setSliding(step.state.phase === "sliding");
    for (const effect of step.effects) run(effect);

    function run(effect: GestureEffect) {
      switch (effect.type) {
        case "startHold":
          clearTimeout(holdTimer.current);
          holdTimer.current = setTimeout(
            () => dispatch({ type: "hold" }),
            HOLD_MS,
          );
          return;
        case "clearHold":
          clearTimeout(holdTimer.current);
          return;
        case "open":
          window.getSelection()?.removeAllRanges();
          latest.current.open();
          return;
        case "close":
          latest.current.close();
          return;
        case "vibrate":
          vibrate();
          return;
        case "choose":
          latest.current.choose(effect.typeId);
          return;
        case "swallowClick":
          swallow.current = true;
          return;
      }
    }
  }, []);

  useEffect(() => () => clearTimeout(holdTimer.current), []);

  // Once the picker is open the finger may not scroll the page. React listens to touchmove
  // passively, so this one is native. Before that the page scrolls normally, which cancels the
  // hold.
  useEffect(() => {
    const element = button.current;
    if (!element) return;
    const hold = (event: TouchEvent) => {
      if (state.current.phase === "sliding" && event.cancelable) {
        event.preventDefault();
      }
    };
    element.addEventListener("touchmove", hold, { passive: false });
    return () => element.removeEventListener("touchmove", hold);
  }, [button]);

  // Nor does it select text while sliding.
  useEffect(() => {
    if (!sliding) return;
    const style = document.documentElement.style;
    style.userSelect = "none";
    style.setProperty("-webkit-user-select", "none");
    return () => {
      style.userSelect = "";
      style.removeProperty("-webkit-user-select");
    };
  }, [sliding]);

  function hitAt(x: number, y: number): Hit {
    const id = document
      .elementFromPoint(x, y)
      ?.closest(REACTION_SELECTOR)
      ?.getAttribute("data-reaction-id");
    const rects = [button.current, picker.current].flatMap((element) =>
      element ? [element.getBoundingClientRect()] : [],
    );
    return {
      reactionId: id == null ? null : Number(id),
      distance: distanceToRects(x, y, rects),
    };
  }

  return {
    hover,
    sliding,
    // True once for the click that follows a gesture which opened the picker.
    consumeSwallowedClick() {
      const swallowed = swallow.current;
      swallow.current = false;
      return swallowed;
    },
    handlers: {
      onPointerDown(event: React.PointerEvent<HTMLButtonElement>) {
        touch.current = event.pointerType !== "mouse";
        if (!touch.current && event.button !== 0) return;
        swallow.current = false;
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          // The gesture still works from the button's own events.
        }
        dispatch({
          type: "down",
          pointer: touch.current ? "touch" : "mouse",
          x: event.clientX,
          y: event.clientY,
          given,
        });
      },
      onPointerMove(event: React.PointerEvent<HTMLButtonElement>) {
        if (state.current.phase === "idle") return;
        dispatch({
          type: "move",
          x: event.clientX,
          y: event.clientY,
          hit: hitAt(event.clientX, event.clientY),
        });
      },
      onPointerUp(event: React.PointerEvent<HTMLButtonElement>) {
        dispatch({ type: "up", hit: hitAt(event.clientX, event.clientY) });
      },
      onPointerCancel() {
        dispatch({ type: "cancel" });
      },
      // A held touch would open the browser's menu over the picker.
      onContextMenu(event: React.MouseEvent) {
        if (touch.current) event.preventDefault();
      },
    },
  };
}
