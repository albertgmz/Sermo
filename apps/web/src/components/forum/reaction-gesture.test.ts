import { describe, expect, test } from "bun:test";
import {
  CANCEL_DISTANCE_PX,
  distanceToRects,
  type GestureEffect,
  type GestureEvent,
  type GestureState,
  type Hit,
  idleGesture,
  reduceGesture,
  SLOP_PX,
} from "./reaction-gesture";

// Feeds the events in order; returns the final state and every effect, in order.
function run(events: GestureEvent[], from: GestureState = idleGesture) {
  let state = from;
  const effects: GestureEffect[] = [];
  for (const event of events) {
    const step = reduceGesture(state, event);
    state = step.state;
    effects.push(...step.effects);
  }
  return { state, effects };
}

const touchDown = (given: number | null = null): GestureEvent => ({
  type: "down",
  pointer: "touch",
  x: 100,
  y: 300,
  given,
});
const mouseDown = (given: number | null = null): GestureEvent => ({
  type: "down",
  pointer: "mouse",
  x: 100,
  y: 300,
  given,
});
const onReaction = (reactionId: number) => ({ reactionId, distance: 0 });
const nearPicker = { reactionId: null, distance: 20 };
const onButton = { reactionId: null, distance: 0 };
const far = { reactionId: null, distance: CANCEL_DISTANCE_PX + 1 };
const move = (hit: Hit, x = 100) =>
  ({ type: "move", x, y: 260, hit }) as GestureEvent;

describe("tap", () => {
  test("a touch that lifts before the hold leaves the tap to the click", () => {
    const { state, effects } = run([
      touchDown(),
      { type: "up", hit: onButton },
    ]);
    expect(effects).toEqual([{ type: "startHold" }, { type: "clearHold" }]);
    expect(state.phase).toBe("idle");
  });

  test("a mouse click starts no hold and opens nothing", () => {
    const { state, effects } = run([
      mouseDown(),
      { type: "up", hit: onButton },
    ]);
    expect(effects).toEqual([]);
    expect(state.phase).toBe("idle");
  });

  test("a hold that arrives after the lift does nothing", () => {
    const { effects } = run([
      touchDown(),
      { type: "up", hit: onButton },
      { type: "hold" },
    ]);
    expect(effects).not.toContainEqual({ type: "open" });
  });
});

describe("scroll before the hold", () => {
  test("a touch that moves past the slop cancels the hold", () => {
    const { state, effects } = run([touchDown(), move(onButton)]);
    expect(effects).toEqual([{ type: "startHold" }, { type: "clearHold" }]);
    expect(state.phase).toBe("idle");
  });

  test("the hold that was already queued does not open the picker", () => {
    const { effects } = run([touchDown(), move(onButton), { type: "hold" }]);
    expect(effects).not.toContainEqual({ type: "open" });
  });

  test("a wobble inside the slop keeps the press", () => {
    const { state } = run([
      touchDown(),
      {
        type: "move",
        x: 100 + SLOP_PX - 1,
        y: 300,
        hit: onButton,
      },
    ]);
    expect(state.phase).toBe("pressing");
  });

  test("the browser taking the touch for a scroll cancels the hold", () => {
    const { state, effects } = run([touchDown(), { type: "cancel" }]);
    expect(effects).toEqual([{ type: "startHold" }, { type: "clearHold" }]);
    expect(state.phase).toBe("idle");
  });
});

describe("hold", () => {
  test("opens the picker, vibrates and swallows the click", () => {
    const { state, effects } = run([touchDown(), { type: "hold" }]);
    expect(state.phase).toBe("sliding");
    expect(effects).toEqual([
      { type: "startHold" },
      { type: "open" },
      { type: "vibrate" },
      { type: "swallowClick" },
    ]);
  });

  test("lifting on the button leaves the picker open", () => {
    const { state, effects } = run([
      touchDown(),
      { type: "hold" },
      { type: "up", hit: onButton },
    ]);
    expect(state.phase).toBe("idle");
    expect(effects).not.toContainEqual({ type: "close" });
    expect(effects.some((effect) => effect.type === "choose")).toBe(false);
  });

  test("lifting near the picker but off it leaves it open", () => {
    const { effects } = run([
      touchDown(),
      { type: "hold" },
      move(nearPicker),
      { type: "up", hit: nearPicker },
    ]);
    expect(effects).not.toContainEqual({ type: "close" });
    expect(effects.some((effect) => effect.type === "choose")).toBe(false);
  });
});

describe("slide", () => {
  test("the reaction under the finger is the hover, with a vibration each time it changes", () => {
    let state = run([touchDown(), { type: "hold" }]).state;
    let step = reduceGesture(state, move(onReaction(2)));
    expect(step.state.hover).toBe(2);
    expect(step.effects).toEqual([{ type: "vibrate" }]);

    state = step.state;
    step = reduceGesture(state, move(onReaction(2), 101));
    expect(step.effects).toEqual([]);

    step = reduceGesture(step.state, move(onReaction(3), 140));
    expect(step.state.hover).toBe(3);
    expect(step.effects).toEqual([{ type: "vibrate" }]);

    step = reduceGesture(step.state, move(nearPicker, 140));
    expect(step.state.hover).toBeNull();
    expect(step.effects).toEqual([]);
  });

  test("lifting on a reaction gives it", () => {
    const { state, effects } = run([
      touchDown(),
      { type: "hold" },
      move(onReaction(3)),
      { type: "up", hit: onReaction(3) },
    ]);
    expect(effects.at(-1)).toEqual({ type: "choose", typeId: 3 });
    expect(state.phase).toBe("idle");
    expect(state.hover).toBeNull();
  });

  test("lifting on the reaction already given takes it back", () => {
    const { effects } = run([
      touchDown(3),
      { type: "hold" },
      move(onReaction(3)),
      { type: "up", hit: onReaction(3) },
    ]);
    expect(effects.at(-1)).toEqual({ type: "choose", typeId: null });
  });

  test("the reaction at the lift wins over the last one moved over", () => {
    const { effects } = run([
      touchDown(),
      { type: "hold" },
      move(onReaction(2)),
      { type: "up", hit: onReaction(4) },
    ]);
    expect(effects.at(-1)).toEqual({ type: "choose", typeId: 4 });
  });

  test("sliding far from the picker cancels and closes it", () => {
    const { state, effects } = run([
      touchDown(),
      { type: "hold" },
      move(onReaction(2)),
      move(far),
    ]);
    expect(state.phase).toBe("cancelled");
    expect(state.hover).toBeNull();
    expect(effects.at(-1)).toEqual({ type: "close" });
  });

  test("a cancelled gesture stays cancelled when the finger comes back and lifts", () => {
    const { state, effects } = run([
      touchDown(),
      { type: "hold" },
      move(far),
      move(onReaction(2)),
      { type: "up", hit: onReaction(2) },
    ]);
    expect(state.phase).toBe("idle");
    expect(effects.some((effect) => effect.type === "choose")).toBe(false);
    expect(effects.filter((effect) => effect.type === "close")).toHaveLength(1);
  });

  test("just inside the cancel distance is still near", () => {
    const { state } = run([
      touchDown(),
      { type: "hold" },
      move({ reactionId: null, distance: CANCEL_DISTANCE_PX }),
    ]);
    expect(state.phase).toBe("sliding");
  });

  test("lifting far away closes the picker and gives nothing", () => {
    const { effects } = run([
      touchDown(),
      { type: "hold" },
      { type: "up", hit: far },
    ]);
    expect(effects.at(-1)).toEqual({ type: "close" });
    expect(effects.some((effect) => effect.type === "choose")).toBe(false);
  });

  test("the system cancelling the touch closes the picker", () => {
    const { state, effects } = run([
      touchDown(),
      { type: "hold" },
      { type: "cancel" },
    ]);
    expect(effects.at(-1)).toEqual({ type: "close" });
    expect(state.phase).toBe("idle");
  });
});

describe("mouse", () => {
  test("a drag past the slop opens the picker and follows the pointer", () => {
    const { state, effects } = run([mouseDown(), move(onReaction(1))]);
    expect(state.phase).toBe("sliding");
    expect(state.hover).toBe(1);
    expect(effects).toEqual([
      { type: "open" },
      { type: "swallowClick" },
      { type: "vibrate" },
    ]);
  });

  test("releasing on a reaction after a drag gives it", () => {
    const { effects } = run([
      mouseDown(),
      move(onReaction(1)),
      { type: "up", hit: onReaction(1) },
    ]);
    expect(effects.at(-1)).toEqual({ type: "choose", typeId: 1 });
  });

  test("dragging far away cancels", () => {
    const { state, effects } = run([mouseDown(), move(far)]);
    expect(state.phase).toBe("cancelled");
    expect(effects.at(-1)).toEqual({ type: "close" });
  });
});

describe("distanceToRects", () => {
  const button = { left: 10, top: 100, right: 50, bottom: 140 };
  const picker = { left: 10, top: 40, right: 200, bottom: 90 };

  test("is 0 inside a rectangle and on its edge", () => {
    expect(distanceToRects(30, 120, [button, picker])).toBe(0);
    expect(distanceToRects(200, 90, [button, picker])).toBe(0);
  });

  test("measures straight off a side", () => {
    expect(distanceToRects(100, 60, [picker])).toBe(0);
    expect(distanceToRects(100, 20, [picker])).toBe(20);
  });

  test("measures to the corner past it, and takes the nearer rectangle", () => {
    expect(distanceToRects(203, 94, [picker])).toBe(5);
    expect(distanceToRects(30, 95, [button, picker])).toBe(5);
  });

  test("is infinite with nothing to measure to", () => {
    expect(distanceToRects(0, 0, [])).toBe(Number.POSITIVE_INFINITY);
  });
});
