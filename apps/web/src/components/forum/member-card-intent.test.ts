import { expect, test } from "bun:test";
import {
  openChange,
  opensOnFocus,
  pointerOver,
  staysOpen,
} from "./member-card-intent";

test("a request to open from a touch or pen pointer is ignored, a mouse's is not", () => {
  expect(openChange(true, "touch")).toBe("ignore");
  expect(openChange(true, "pen")).toBe("ignore");
  expect(openChange(true, "mouse")).toBe("open");
  expect(openChange(true, "")).toBe("open");
  expect(openChange(false, "touch")).toBe("close");
});

test("focus opens the card of a name seen by keyboard, never of an avatar or after a tap", () => {
  const base = { pointerType: "", avatar: false, focusVisible: true };
  expect(opensOnFocus(base)).toBe(true);
  expect(opensOnFocus({ ...base, avatar: true })).toBe(false);
  expect(opensOnFocus({ ...base, focusVisible: false })).toBe(false);
  expect(opensOnFocus({ ...base, pointerType: "touch" })).toBe(false);
  expect(opensOnFocus({ ...base, pointerType: "pen" })).toBe(false);
});

test("a hover close is dropped while the pointer rests on the name or the card, nothing else is", () => {
  expect(staysOpen("trigger-hover", true)).toBe(true);
  expect(staysOpen("trigger-hover", false)).toBe(false);
  expect(staysOpen("escape-key", true)).toBe(false);
  expect(staysOpen("outside-press", true)).toBe(false);
});

test("the pointer is over an element when the browser says it is hovered", () => {
  const hovered = { matches: (selector: string) => selector === ":hover" };
  const idle = { matches: () => false };
  expect(
    pointerOver(idle as unknown as Element, hovered as unknown as Element),
  ).toBe(true);
  expect(pointerOver(idle as unknown as Element, null, undefined)).toBe(false);
  expect(pointerOver()).toBe(false);
});
