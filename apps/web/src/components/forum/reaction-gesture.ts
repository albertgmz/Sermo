// The press, slide and release gesture of the reaction button as a pure state machine: the
// component feeds it pointer events and carries out the effects it returns, so every state can be
// held in a test without a DOM.

// A touch held this long opens the picker.
export const HOLD_MS = 450;
// How far a finger or mouse may drift before the press stops being a press: a touch that moves
// sooner is a scroll, a mouse that moves is a drag.
export const SLOP_PX = 8;
// Off the picker and the button by more than this (about a finger's width) cancels the gesture.
export const CANCEL_DISTANCE_PX = 48;

export type Pointer = "touch" | "mouse";

// What is under the finger: the reaction there, if any, and how far the point is from the button
// and the picker (0 on either of them).
export type Hit = { reactionId: number | null; distance: number };

export type GestureState = {
  phase: "idle" | "pressing" | "sliding" | "cancelled";
  pointer: Pointer;
  originX: number;
  originY: number;
  // The reaction the viewer already gave, so lifting on it takes it back.
  given: number | null;
  // The reaction under the finger while sliding.
  hover: number | null;
};

export type GestureEvent =
  | {
      type: "down";
      pointer: Pointer;
      x: number;
      y: number;
      given: number | null;
    }
  | { type: "hold" }
  | { type: "move"; x: number; y: number; hit: Hit }
  | { type: "up"; hit: Hit }
  | { type: "cancel" };

export type GestureEffect =
  | { type: "startHold" }
  | { type: "clearHold" }
  | { type: "open" }
  | { type: "close" }
  | { type: "vibrate" }
  | { type: "choose"; typeId: number | null }
  // The click that follows the lift must not give the first reaction as a tap would.
  | { type: "swallowClick" };

export const idleGesture: GestureState = {
  phase: "idle",
  pointer: "touch",
  originX: 0,
  originY: 0,
  given: null,
  hover: null,
};

type Step = { state: GestureState; effects: GestureEffect[] };

const stay = (state: GestureState): Step => ({ state, effects: [] });

function moved(state: GestureState, x: number, y: number) {
  return Math.hypot(x - state.originX, y - state.originY) > SLOP_PX;
}

// The finger is down on the picker's side of the gesture: follow it to a reaction, or give up
// when it has gone far from everything.
function slide(state: GestureState, hit: Hit, effects: GestureEffect[]): Step {
  if (hit.reactionId === null && hit.distance > CANCEL_DISTANCE_PX) {
    return {
      state: { ...state, phase: "cancelled", hover: null },
      effects: [...effects, { type: "close" }],
    };
  }
  const changed = hit.reactionId !== state.hover;
  return {
    state: { ...state, hover: hit.reactionId },
    effects:
      changed && hit.reactionId !== null
        ? [...effects, { type: "vibrate" }]
        : effects,
  };
}

export function reduceGesture(state: GestureState, event: GestureEvent): Step {
  switch (event.type) {
    case "down":
      return {
        state: {
          phase: "pressing",
          pointer: event.pointer,
          originX: event.x,
          originY: event.y,
          given: event.given,
          hover: null,
        },
        // A mouse opens the picker by hovering or by dragging, not by holding.
        effects: event.pointer === "touch" ? [{ type: "startHold" }] : [],
      };

    case "hold":
      if (state.phase !== "pressing") return stay(state);
      return {
        state: { ...state, phase: "sliding" },
        effects: [
          { type: "open" },
          { type: "vibrate" },
          { type: "swallowClick" },
        ],
      };

    case "move":
      if (state.phase === "pressing") {
        if (!moved(state, event.x, event.y)) return stay(state);
        if (state.pointer === "touch") {
          // The finger moved before the hold: the page is scrolling.
          return {
            state: { ...state, phase: "idle" },
            effects: [{ type: "clearHold" }],
          };
        }
        return slide({ ...state, phase: "sliding" }, event.hit, [
          { type: "open" },
          { type: "swallowClick" },
        ]);
      }
      if (state.phase === "sliding") return slide(state, event.hit, []);
      return stay(state);

    case "up": {
      const idle = { ...state, phase: "idle" as const, hover: null };
      if (state.phase === "pressing") {
        // A tap: the click that follows gives or takes back the first reaction.
        return {
          state: idle,
          effects: state.pointer === "touch" ? [{ type: "clearHold" }] : [],
        };
      }
      if (state.phase !== "sliding") return { state: idle, effects: [] };
      const id = event.hit.reactionId;
      if (id !== null) {
        return {
          state: idle,
          effects: [{ type: "choose", typeId: id === state.given ? null : id }],
        };
      }
      // Lifted off every reaction: back on the button or near the picker it stays open for a
      // tap; far from both it closes.
      return {
        state: idle,
        effects:
          event.hit.distance > CANCEL_DISTANCE_PX ? [{ type: "close" }] : [],
      };
    }

    case "cancel": {
      const idle = { ...state, phase: "idle" as const, hover: null };
      if (state.phase === "pressing") {
        return { state: idle, effects: [{ type: "clearHold" }] };
      }
      if (state.phase === "sliding") {
        return { state: idle, effects: [{ type: "close" }] };
      }
      return { state: idle, effects: [] };
    }
  }
}

export type Rect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

// The distance from a point to the nearest of the rectangles, 0 inside one.
export function distanceToRects(x: number, y: number, rects: Rect[]) {
  let nearest = Number.POSITIVE_INFINITY;
  for (const rect of rects) {
    const dx = Math.max(rect.left - x, 0, x - rect.right);
    const dy = Math.max(rect.top - y, 0, y - rect.bottom);
    nearest = Math.min(nearest, Math.hypot(dx, dy));
  }
  return nearest;
}
