import { expect, test } from "bun:test";
import {
  attachTag,
  insertAtCaret,
  insertIntoComposer,
  onComposerInsert,
} from "./composer-insert";

// A form is an event target, and what is inside it finds it with `closest`.
function composer() {
  const form = new EventTarget() as unknown as HTMLFormElement;
  const inside = { closest: () => form } as unknown as Element;
  return { form, inside };
}

test("the tags are the ones the renderer reads", () => {
  expect(attachTag(7, "thumb")).toBe("[ATTACH]7[/ATTACH]");
  expect(attachTag(7, "full")).toBe("[ATTACH=full]7[/ATTACH]");
});

test("a request reaches the box of its own composer only", () => {
  const mine = composer();
  const other = composer();
  const got: string[] = [];
  const stopMine = onComposerInsert(mine.form, (text) =>
    got.push(`mine ${text}`),
  );
  onComposerInsert(other.form, (text) => got.push(`other ${text}`));
  insertIntoComposer(mine.inside, "[ATTACH]1[/ATTACH]");
  expect(got).toEqual(["mine [ATTACH]1[/ATTACH]"]);
  stopMine();
  insertIntoComposer(mine.inside, "again");
  expect(got).toHaveLength(1);
});

test("a plain field takes the text over its selection and keeps the caret after it", () => {
  const calls: unknown[][] = [];
  const field = {
    selectionStart: 3,
    selectionEnd: 5,
    setRangeText: (...args: unknown[]) => calls.push(args),
    focus: () => calls.push(["focus"]),
  } as unknown as HTMLTextAreaElement;
  insertAtCaret(field, "[ATTACH]2[/ATTACH]");
  expect(calls).toEqual([["[ATTACH]2[/ATTACH]", 3, 5, "end"], ["focus"]]);
});
