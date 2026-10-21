import { expect, test } from "bun:test";
import { menuEntries } from "./content-menu-popup";

const select = () => {};

test("the menu holds edit, then delete, each only when given", () => {
  expect(menuEntries({})).toEqual([]);
  expect(menuEntries({ onDelete: select }).map((entry) => entry.id)).toEqual([
    "delete",
  ]);
  expect(
    menuEntries({ edit: select, onDelete: select }).map((entry) => entry.id),
  ).toEqual(["edit", "delete"]);
});

test("edit goes to its page when it has one, and opens the panel under the bar otherwise", () => {
  expect(menuEntries({ edit: "/threads/3/edit/1" })).toEqual([
    { id: "edit", href: "/threads/3/edit/1" },
  ]);
  const open = () => {};
  expect(menuEntries({ edit: open })).toEqual([{ id: "edit", select: open }]);
});

test("delete opens its panel under the bar", () => {
  const open = () => {};
  expect(menuEntries({ onDelete: open })).toEqual([
    { id: "delete", select: open },
  ]);
});
