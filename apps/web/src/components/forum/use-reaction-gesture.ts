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
  locksPage,
  type Rect,
  reduceGesture,
} from "@/components/forum/reaction-gesture";

// A touch stays captured by the button it started on, so the reaction under the finger is found
// from its position: each reaction in the picker carries `data-reaction-id`.
const REACTION_SELECTOR = "[data-reaction-id]";
// How long after a lift a pending "swallow the click" outlives it: the click comes right after
// the lift, and some browsers send none.
const SWALLOW_MS = 100;
// How long after a gesture the pointer leaving the button does not count as leaving the picker:
// releasing a capture makes the browser report the leave that was held back.
const RELEASE_MS = 300;

// Where a point that has not been looked up is: only a mouse in the middle of a press needs it.
const NO_HIT: Hit = { reactionId: null, overButton: true, distance: 0 };

function vibrate() {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) {
    navigator.vibrate(10);
  }
}

// Carries the reaction button's pointer events through the gesture machine and carries out its
// effects. While the finger slides, the page does not scroll and no text is selected.
export function useReactionGesture({
  picker,
  pickerExpected,
  given,
  open,
  close,
  choose,
}: {
  picker: RefObject<HTMLElement | null>;
  // The box the picker will take while it is asked for but not drawn yet (its code is on its way):
  // the gesture is measured against it, so a slide toward it waits for it and one away gives up.
  pickerExpected: () => Rect | undefined;
  given: number | null;
  open: () => void;
  close: () => void;
  choose: (typeId: number | null) => void;
}) {
  const button = useRef<HTMLButtonElement | null>(null);
  const state = useRef(idleGesture);
  const holdTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const swallowTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const swallow = useRef(false);
  const touch = useRef(false);
  const releasedAt = useRef(0);
  const [hover, setHover] = useState<number | null>(null);
  const [locked, setLocked] = useState(false);
  // The callbacks change every render; the machine's effects use the latest.
  const latest = useRef({ open, close, choose });
  latest.current = { open, close, choose };

  const dispatch = useCallback((event: GestureEvent) => {
    const before = state.current;
    const step = reduceGesture(before, event);
    state.current = step.state;
    setHover(step.state.hover);
    setLocked(locksPage(step.state));
    if (locksPage(before) && !locksPage(step.state)) {
      releasedAt.current = Date.now();
    }
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

  useEffect(
    () => () => {
      clearTimeout(holdTimer.current);
      clearTimeout(swallowTimer.current);
    },
    [],
  );

  // Once the picker is open the finger may not scroll the page, and that holds until it lifts,
  // also after a slide away has closed the picker. React listens to touchmove passively, so the
  // block is a native listener, attached whenever the button is drawn (it may be drawn later than
  // the hook runs). Before the picker opens the page scrolls normally, which cancels the hold.
  const buttonRef = useCallback(
    (node: HTMLButtonElement | null) => {
      button.current = node;
      if (!node) return;
      const block = (event: TouchEvent) => {
        if (locksPage(state.current) && event.cancelable)
          event.preventDefault();
      };
      node.addEventListener("touchmove", block, { passive: false });
      return () => {
        node.removeEventListener("touchmove", block);
        button.current = null;
        // A button drawn away mid-gesture never hears the end: let go of the page.
        dispatch({ type: "cancel", pointerId: state.current.pointerId });
      };
    },
    [dispatch],
  );

  // Nor does it select text meanwhile.
  useEffect(() => {
    if (!locked) return;
    const style = document.documentElement.style;
    style.userSelect = "none";
    style.setProperty("-webkit-user-select", "none");
    return () => {
      style.userSelect = "";
      style.removeProperty("-webkit-user-select");
    };
  }, [locked]);

  function hitAt(x: number, y: number): Hit {
    const id = document
      .elementFromPoint(x, y)
      ?.closest(REACTION_SELECTOR)
      ?.getAttribute("data-reaction-id");
    const buttonRect = button.current?.getBoundingClientRect();
    const pickerRect =
      picker.current?.getBoundingClientRect() ?? pickerExpected();
    return {
      reactionId: id == null ? null : Number(id),
      overButton: buttonRect
        ? distanceToRects(x, y, [buttonRect]) === 0
        : false,
      distance: distanceToRects(
        x,
        y,
        [buttonRect, pickerRect].filter((rect) => rect !== undefined),
      ),
    };
  }

  function end() {
    // The click that follows the lift is swallowed; if none comes, the flag must not wait for a
    // keyboard or screen reader click.
    clearTimeout(swallowTimer.current);
    swallowTimer.current = setTimeout(() => {
      swallow.current = false;
    }, SWALLOW_MS);
  }

  return {
    buttonRef,
    button,
    hover,
    // True once for the click that follows a gesture which opened the picker.
    consumeSwallowedClick() {
      const swallowed = swallow.current;
      swallow.current = false;
      return swallowed;
    },
    // A mouse drag has just ended: the pointer leaving the button is the capture letting go.
    justReleased() {
      return Date.now() - releasedAt.current < RELEASE_MS;
    },
    handlers: {
      onPointerDown(event: React.PointerEvent<HTMLButtonElement>) {
        touch.current = event.pointerType !== "mouse";
        if (!touch.current && event.button !== 0) return;
        clearTimeout(swallowTimer.current);
        swallow.current = false;
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          // The gesture still works from the button's own events.
        }
        dispatch({
          type: "down",
          pointer: touch.current ? "touch" : "mouse",
          pointerId: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          given,
        });
      },
      onPointerMove(event: React.PointerEvent<HTMLButtonElement>) {
        const { phase, pointer } = state.current;
        if (phase === "idle") return;
        // A touch before the hold only needs to know how far it moved.
        const needsHit = phase !== "pressing" || pointer === "mouse";
        dispatch({
          type: "move",
          pointerId: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          hit: needsHit ? hitAt(event.clientX, event.clientY) : NO_HIT,
        });
      },
      onPointerUp(event: React.PointerEvent<HTMLButtonElement>) {
        if (state.current.phase === "idle") return;
        dispatch({
          type: "up",
          pointerId: event.pointerId,
          hit: hitAt(event.clientX, event.clientY),
        });
        end();
      },
      onPointerCancel(event: React.PointerEvent<HTMLButtonElement>) {
        dispatch({ type: "cancel", pointerId: event.pointerId });
        end();
      },
      // The capture ending for any other reason ends the gesture.
      onLostPointerCapture(event: React.PointerEvent<HTMLButtonElement>) {
        dispatch({ type: "cancel", pointerId: event.pointerId });
        end();
      },
      // A held touch would open the browser's menu over the picker.
      onContextMenu(event: React.MouseEvent) {
        if (touch.current) event.preventDefault();
      },
    },
  };
}
