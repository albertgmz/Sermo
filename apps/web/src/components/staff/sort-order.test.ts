import { expect, test } from "bun:test";
import { focusKeeper, moved, positionsFor } from "./sort-order";

test("an entry moves one place up or down, and stays at the ends of the list", () => {
  expect(moved(["a", "b", "c"], 1, -1)).toEqual(["b", "a", "c"]);
  expect(moved(["a", "b", "c"], 1, 1)).toEqual(["a", "c", "b"]);
  expect(moved(["a", "b", "c"], 0, -1)).toEqual(["a", "b", "c"]);
  expect(moved(["a", "b", "c"], 2, 1)).toEqual(["a", "b", "c"]);
  const list = ["a", "b"];
  moved(list, 0, 1);
  expect(list).toEqual(["a", "b"]);
});

test("the numbers the entries held are handed out again, so only the moved ones change", () => {
  // b (20) moved above a (10): they swap numbers, c keeps 35.
  const order = [{ position: 20 }, { position: 10 }, { position: 35 }];
  expect(positionsFor(order)).toEqual([10, 20, 35]);
  expect(positionsFor([])).toEqual([]);
});

test("numbers shared by two entries cannot hold an order, so every entry is numbered anew", () => {
  const order = [{ position: 0 }, { position: 0 }, { position: 4 }];
  expect(positionsFor(order)).toEqual([10, 20, 30]);
});

test("the arrow that moved an entry gets the focus back once the list is drawn again", () => {
  const focused: string[] = [];
  const node = (name: string) => ({ focus: () => focused.push(name) });
  const keeper = focusKeeper<{ focus(): void }>();
  keeper.ref("7:down")(node("old 7 down"));
  keeper.ref("9:down")(node("9 down"));
  keeper.want("7:down");
  // The redraw detaches the entry's arrow and attaches it again in its new place.
  keeper.ref("7:down")(null);
  keeper.ref("7:down")(node("7 down"));
  keeper.restore();
  expect(focused).toEqual(["7 down"]);
  // Nothing more until another move asks.
  keeper.restore();
  expect(focused).toEqual(["7 down"]);
  // An arrow no longer drawn takes nothing.
  keeper.want("3:up");
  keeper.restore();
  expect(focused).toEqual(["7 down"]);
});
