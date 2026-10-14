import { expect, test } from "bun:test";
import {
  isPressOnAnchor,
  opensCard,
  opensCardKey,
  returnsFocusToLink,
  settledCard,
} from "./member-card-intent";

const plain = {
  button: 0,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
};

test("a plain primary click opens the card", () => {
  expect(opensCard(plain)).toBe(true);
});

test("a modified, middle or secondary click keeps the browser's default", () => {
  expect(opensCard({ ...plain, ctrlKey: true })).toBe(false);
  expect(opensCard({ ...plain, metaKey: true })).toBe(false);
  expect(opensCard({ ...plain, shiftKey: true })).toBe(false);
  expect(opensCard({ ...plain, altKey: true })).toBe(false);
  expect(opensCard({ ...plain, button: 1 })).toBe(false);
  expect(opensCard({ ...plain, button: 2 })).toBe(false);
});

test("Space opens the card, other keys do not", () => {
  expect(opensCardKey(" ")).toBe(true);
  expect(opensCardKey("Enter")).toBe(false);
  expect(opensCardKey("a")).toBe(false);
});

test("a click made from Space on key up opens the card like any plain click", () => {
  // Base UI turns Space into a click with the key's modifiers; the trigger handles only that click.
  expect(opensCard(plain)).toBe(true);
  expect(opensCard({ ...plain, shiftKey: true })).toBe(false);
});

test("a card that could not be read keeps the one it had, else shows the fallback", () => {
  expect(settledCard(undefined, null, "fallback")).toBe("fallback");
  expect(settledCard(undefined, undefined, "fallback")).toBe("fallback");
  expect(settledCard("old", null, "fallback")).toBe("old");
  expect(settledCard("old", "new", "fallback")).toBe("new");
  expect(settledCard(undefined, "new", "fallback")).toBe("new");
});

test("focus returns to a mention after Escape or from inside the card, while it is on the page", () => {
  const base = { reason: "outside-press", focusInside: false, connected: true };
  expect(returnsFocusToLink({ ...base, reason: "escape-key" })).toBe(true);
  expect(returnsFocusToLink({ ...base, focusInside: true })).toBe(true);
  expect(returnsFocusToLink(base)).toBe(false);
  expect(returnsFocusToLink({ ...base, reason: undefined })).toBe(false);
  expect(
    returnsFocusToLink({ ...base, reason: "escape-key", connected: false }),
  ).toBe(false);
  expect(
    returnsFocusToLink({ ...base, focusInside: true, connected: false }),
  ).toBe(false);
});

test("a press on the anchor of the open card is not a dismissal", () => {
  class FakeNode {}
  const inside = new FakeNode();
  const anchor = {
    contains: (node: Node | null) => node === (inside as unknown),
  };
  const press = (reason: string, target: unknown) => ({
    reason,
    event: { target: target as EventTarget },
  });
  const original = globalThis.Node;
  globalThis.Node = FakeNode as unknown as typeof Node;
  try {
    expect(isPressOnAnchor(press("outside-press", inside), anchor)).toBe(true);
    expect(
      isPressOnAnchor(press("outside-press", new FakeNode()), anchor),
    ).toBe(false);
    expect(isPressOnAnchor(press("escape-key", inside), anchor)).toBe(false);
    expect(isPressOnAnchor(press("outside-press", null), anchor)).toBe(false);
  } finally {
    globalThis.Node = original;
  }
});
