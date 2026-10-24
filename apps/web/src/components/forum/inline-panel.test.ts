import { expect, test } from "bun:test";
import { claimPanel, escapeCloses, watchPanel } from "./inline-panel";

test("opening a form in place closes the one open elsewhere, so one is open at a time", () => {
  const closed: string[] = [];
  const stopTags = watchPanel("tags", () => closed.push("tags"));
  const stopPoll = watchPanel("poll", () => closed.push("poll"));
  claimPanel("poll");
  expect(closed).toEqual(["tags"]);
  claimPanel("tags");
  expect(closed).toEqual(["tags", "poll"]);
  // A form that is gone is not closed again.
  stopPoll();
  claimPanel("tags");
  expect(closed).toEqual(["tags", "poll"]);
  stopTags();
});

test("Escape closes the form only when pressed in it, not in a popup of its own drawn elsewhere", () => {
  const field = new EventTarget();
  const popupItem = new EventTarget();
  const box = { contains: (node: unknown) => node === field };
  const press = (over: Partial<Parameters<typeof escapeCloses>[0]>) =>
    escapeCloses({
      key: "Escape",
      defaultPrevented: false,
      target: field,
      currentTarget: box,
      ...over,
    });
  expect(press({})).toBe(true);
  expect(press({ key: "Enter" })).toBe(false);
  // A popup that already took the key, or one portalled out of the form (React still bubbles its
  // keys through the form), keeps the form open.
  expect(press({ defaultPrevented: true })).toBe(false);
  expect(press({ target: popupItem })).toBe(false);
});
