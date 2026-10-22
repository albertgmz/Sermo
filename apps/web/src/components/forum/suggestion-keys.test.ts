import { expect, test } from "bun:test";
import {
  createEditor,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_UP_COMMAND,
  KEY_ENTER_COMMAND,
  KEY_ESCAPE_COMMAND,
  KEY_TAB_COMMAND,
} from "lexical";
import { registerSuggestionKeys } from "./suggestion-keys";

// An editor whose list shows `count` options, `active` the active one, and what its keys did.
function listOf(count: number, active = 0) {
  const editor = createEditor({
    onError: (error) => {
      throw error;
    },
  });
  const did: string[] = [];
  registerSuggestionKeys(editor, () => ({ count, active }), {
    move: (index) => did.push(`move ${index}`),
    pick: (index) => did.push(`pick ${index}`),
    close: () => did.push("close"),
  });
  return { editor, did };
}

// A key press as the editor's commands get it.
function press() {
  const event = {
    prevented: false,
    stopped: false,
    preventDefault() {
      event.prevented = true;
    },
    stopPropagation() {
      event.stopped = true;
    },
  };
  return event;
}

test("the arrow keys move through the options, round from one end to the other", () => {
  const { editor, did } = listOf(3, 2);
  editor.dispatchCommand(KEY_ARROW_DOWN_COMMAND, press() as never);
  editor.dispatchCommand(KEY_ARROW_UP_COMMAND, press() as never);
  expect(did).toEqual(["move 0", "move 1"]);
});

test("Enter and Tab pick the active option, Escape closes, and the press goes no further", () => {
  const { editor, did } = listOf(3, 1);
  const enter = press();
  expect(editor.dispatchCommand(KEY_ENTER_COMMAND, enter as never)).toBe(true);
  editor.dispatchCommand(KEY_TAB_COMMAND, press() as never);
  const close = press();
  editor.dispatchCommand(KEY_ESCAPE_COMMAND, close as never);
  expect(did).toEqual(["pick 1", "pick 1", "close"]);
  expect(enter).toMatchObject({ prevented: true, stopped: true });
  expect(close).toMatchObject({ prevented: true, stopped: true });
});

test("with no options the keys are the editor's as always", () => {
  const { editor, did } = listOf(0);
  const enter = press();
  expect(editor.dispatchCommand(KEY_ENTER_COMMAND, enter as never)).toBe(false);
  editor.dispatchCommand(KEY_ESCAPE_COMMAND, press() as never);
  expect(did).toEqual([]);
  expect(enter.prevented).toBe(false);
});
