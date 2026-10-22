import { expect, test } from "bun:test";
import { menuEntries } from "./content-menu-popup";

test("the menu holds edit, then delete, each only when given, each opening its panel", () => {
  const edit = () => {};
  const remove = () => {};
  expect(menuEntries({})).toEqual([]);
  expect(menuEntries({ onDelete: remove })).toEqual([
    { id: "delete", select: remove },
  ]);
  expect(menuEntries({ onEdit: edit, onDelete: remove })).toEqual([
    { id: "edit", select: edit },
    { id: "delete", select: remove },
  ]);
});
