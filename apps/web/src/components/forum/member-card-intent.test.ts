import { expect, test } from "bun:test";
import { openChange, opensOnFocus } from "./member-card-intent";

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
