import { expect, test } from "bun:test";
import { prefixChoices } from "./threads";

const prefix = (id: number, label: string) => ({
  id,
  label,
  color: "#336699",
  icon: "",
});
const inactive = (label: string) => `(inactive) ${label}`;

test("a thread whose prefix is active is offered the active prefixes as they are", () => {
  const active = [prefix(1, "News"), prefix(2, "Help")];
  expect(prefixChoices(active, prefix(2, "Help"), inactive)).toEqual(active);
  expect(prefixChoices(active, null, inactive)).toEqual(active);
});

test("a prefix that is no longer active stays selectable, marked as inactive", () => {
  const active = [prefix(1, "News")];
  expect(prefixChoices(active, prefix(7, "Old"), inactive)).toEqual([
    prefix(1, "News"),
    { ...prefix(7, "Old"), label: "(inactive) Old" },
  ]);
});
