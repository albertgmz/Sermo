import { expect, test } from "bun:test";
import { replayOnce } from "./lazy-popup-replay";

function element() {
  const calls: string[] = [];
  return {
    calls,
    focus: () => calls.push("focus"),
    click: () => calls.push("click"),
    dispatchEvent: (event: unknown) =>
      calls.push(`key:${(event as { key: string }).key}`),
  };
}
const makeKey = (key: string) => ({ key });

test("Enter and Space are replayed as a click on the real trigger, after focusing it", () => {
  const trigger = element();
  replayOnce(makeKey)(trigger, "click");
  expect(trigger.calls).toEqual(["focus", "click"]);
});

test("ArrowDown and ArrowUp are replayed as the key", () => {
  const down = element();
  replayOnce(makeKey)(down, "ArrowDown");
  expect(down.calls).toEqual(["focus", "key:ArrowDown"]);
  const up = element();
  replayOnce(makeKey)(up, "ArrowUp");
  expect(up.calls).toEqual(["focus", "key:ArrowUp"]);
});

test("nothing is replayed for a menu that mounts open, or before the trigger is there", () => {
  const trigger = element();
  const run = replayOnce(makeKey);
  run(trigger, null);
  run(null, "click");
  expect(trigger.calls).toEqual([]);
  // and those did not use up the replay
  run(trigger, "click");
  expect(trigger.calls).toEqual(["focus", "click"]);
});

test("a second run of the effect (Strict Mode, a hidden subtree shown again) does not click the open menu shut", () => {
  const trigger = element();
  const run = replayOnce(makeKey);
  run(trigger, "click");
  run(trigger, "click");
  run(trigger, "click");
  expect(trigger.calls).toEqual(["focus", "click"]);

  const arrow = element();
  const again = replayOnce(makeKey);
  again(arrow, "ArrowDown");
  again(arrow, "ArrowDown");
  expect(arrow.calls).toEqual(["focus", "key:ArrowDown"]);
});
