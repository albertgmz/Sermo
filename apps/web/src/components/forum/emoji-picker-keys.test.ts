import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type KeyAction,
  type KeyPlace,
  nextOption,
  pickerKey,
  registerPickerKeys,
} from "./emoji-picker-keys";

// The picker inside a form inside a dialog, as the new-thread sheet is: the form sends itself on an
// Enter in a text field that nobody prevented, and the dialog closes on an Escape that reaches the
// document. The picker is below both, so its own listener runs first.
function page(place: KeyPlace) {
  const picker = new EventTarget();
  const done: string[] = [];
  const actions: KeyAction[] = [];
  const stop = registerPickerKeys(
    picker,
    () => place,
    (action) => actions.push(action),
  );
  const press = (key: string, composing = false) => {
    const event = new Event("keydown", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "key", { value: key });
    Object.defineProperty(event, "isComposing", { value: composing });
    let stopped = false;
    const halt = event.stopPropagation.bind(event);
    event.stopPropagation = () => {
      stopped = true;
      halt();
    };
    picker.dispatchEvent(event);
    if (key === "Enter" && !event.defaultPrevented) done.push("form sent");
    if (key === "Escape" && !stopped) done.push("dialog closed");
    return event;
  };
  return { press, done, actions, stop };
}

test("Enter in the search box picks the first option and never sends the form", () => {
  const { press, done, actions } = page({ in: "search", empty: false });
  press("Enter");
  expect(done).toEqual([]);
  expect(actions).toEqual([{ do: "pickFirst" }]);
});

test("Enter in an empty search box sends nothing and puts nothing in", () => {
  const { press, done, actions } = page({ in: "search", empty: true });
  expect(press("Enter").defaultPrevented).toBe(true);
  expect(done).toEqual([]);
  expect(actions).toEqual([]);
});

test("Enter and Escape that end or cancel a composition are the keyboard's, not the picker's", () => {
  const { press, actions } = page({ in: "search", empty: false });
  expect(press("Enter", true).defaultPrevented).toBe(false);
  press("Escape", true);
  // Safari sends the key that ends a composition with keyCode 229.
  const safari = new Event("keydown", { bubbles: true, cancelable: true });
  Object.defineProperty(safari, "key", { value: "Enter" });
  Object.defineProperty(safari, "keyCode", { value: 229 });
  const picker = new EventTarget();
  const acted: KeyAction[] = [];
  registerPickerKeys(
    picker,
    () => ({ in: "search", empty: false }),
    (action) => acted.push(action),
  );
  picker.dispatchEvent(safari);
  expect(safari.defaultPrevented).toBe(false);
  expect([...actions, ...acted]).toEqual([]);
});

test("Escape in the picker closes the picker only, not the dialog it is in", () => {
  for (const place of [
    { in: "search", empty: false },
    { in: "option", index: 2, count: 9, columns: 8 },
    { in: "other" },
  ] as KeyPlace[]) {
    const { press, done, actions } = page(place);
    press("Escape");
    expect(done).toEqual([]);
    expect(actions).toEqual([{ do: "close" }]);
  }
});

test("keys the picker does not use pass on", () => {
  const { press, done, actions, stop } = page({ in: "other" });
  const event = press("Enter");
  expect(event.defaultPrevented).toBe(false);
  expect(done).toEqual(["form sent"]);
  expect(actions).toEqual([]);
  stop();
});

test("the down arrow goes from the search box to the options, the arrows move among them", () => {
  expect(pickerKey("ArrowDown", { in: "search", empty: false })).toEqual({
    do: "focus",
    index: 0,
  });
  expect(pickerKey("a", { in: "search", empty: false })).toBeNull();
  expect(
    pickerKey("ArrowDown", { in: "option", index: 3, count: 20, columns: 8 }),
  ).toEqual({ do: "focus", index: 11 });
  expect(
    pickerKey("Enter", { in: "option", index: 3, count: 20, columns: 8 }),
  ).toBeNull();
});

test("the arrows move along a row and between rows, Home and End to the ends, never past them", () => {
  expect(nextOption("ArrowRight", 3, 20, 8)).toBe(4);
  expect(nextOption("ArrowLeft", 0, 20, 8)).toBe(0);
  expect(nextOption("ArrowDown", 3, 20, 8)).toBe(11);
  expect(nextOption("ArrowDown", 15, 20, 8)).toBe(19);
  expect(nextOption("ArrowUp", 3, 20, 8)).toBe(0);
  expect(nextOption("Home", 9, 20, 8)).toBe(0);
  expect(nextOption("End", 9, 20, 8)).toBe(19);
  expect(nextOption("a", 9, 20, 8)).toBeNull();
});

test("the picker takes its keys through the native listener, not React's", () => {
  const source = readFileSync(
    join(import.meta.dir, "emoji-picker.tsx"),
    "utf8",
  );
  expect(source).toContain("registerPickerKeys(");
  expect(source).not.toContain("onKeyDown");
});
