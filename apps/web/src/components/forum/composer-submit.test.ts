import { expect, test } from "bun:test";
import { createEditor, KEY_ENTER_COMMAND } from "lexical";
import {
  isSubmitShortcut,
  submitComposer,
  submitOnShortcut,
} from "./composer-submit";
import { registerSubmitShortcut } from "./editor-commands";
import { registerSuggestionKeys } from "./suggestion-keys";

const keys = (over: Partial<Parameters<typeof isSubmitShortcut>[0]> = {}) => ({
  key: "Enter",
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  repeat: false,
  isComposing: false,
  ...over,
});

test("Ctrl+Enter is the shortcut, and Cmd+Enter on a Mac", () => {
  expect(isSubmitShortcut(keys({ ctrlKey: true }), false)).toBe(true);
  expect(isSubmitShortcut(keys({ metaKey: true }), true)).toBe(true);
  expect(isSubmitShortcut(keys({ ctrlKey: true }), true)).toBe(true);
});

test("Enter alone, Windows+Enter, Shift or Alt with it, a held key and a word being composed are not", () => {
  expect(isSubmitShortcut(keys(), false)).toBe(false);
  expect(isSubmitShortcut(keys({ metaKey: true }), false)).toBe(false);
  expect(isSubmitShortcut(keys({ ctrlKey: true, shiftKey: true }), false)).toBe(
    false,
  );
  expect(isSubmitShortcut(keys({ ctrlKey: true, altKey: true }), false)).toBe(
    false,
  );
  expect(isSubmitShortcut(keys({ ctrlKey: true, repeat: true }), false)).toBe(
    false,
  );
  expect(
    isSubmitShortcut(keys({ ctrlKey: true, isComposing: true }), false),
  ).toBe(false);
  expect(isSubmitShortcut(keys({ ctrlKey: true, key: "a" }), false)).toBe(
    false,
  );
});

// A form with one submit button, and what was sent through it.
function formWith(
  button: { disabled?: boolean; ariaDisabled?: boolean } | null,
) {
  const sent: unknown[] = [];
  const submitter = button && {
    disabled: button.disabled ?? false,
    getAttribute: (name: string) =>
      name === "aria-disabled" && button.ariaDisabled ? "true" : null,
  };
  const form = {
    querySelector: (selector: string) =>
      selector === 'button[type="submit"]' ? submitter : null,
    requestSubmit: (by: unknown) => sent.push(by),
  } as unknown as HTMLFormElement;
  return { form, sent, submitter };
}

test("the form is sent through its submit button, as a press on it would", () => {
  const { form, sent, submitter } = formWith({});
  expect(submitComposer(form, "Hello")).toBe(true);
  expect(sent).toEqual([submitter]);
});

test("nothing is sent while the text is empty, or the button is off", () => {
  for (const [form, text] of [
    [formWith({}), ""],
    [formWith({}), "  \n "],
    [formWith({ disabled: true }), "Hello"],
    [formWith({ ariaDisabled: true }), "Hello"],
    [formWith(null), "Hello"],
  ] as const) {
    expect(submitComposer(form.form, text)).toBe(false);
    expect(form.sent).toEqual([]);
  }
  expect(submitComposer(null, "Hello")).toBe(false);
});

// A key press in a text field as the handler gets it.
function press(over: Partial<ReturnType<typeof keys>>, form: HTMLFormElement) {
  let prevented = false;
  const native = { ...keys(over), defaultPrevented: false };
  submitOnShortcut({
    nativeEvent: native,
    preventDefault: () => {
      prevented = true;
    },
    currentTarget: { form, value: "Hello" },
  } as never);
  return prevented;
}

test("in a plain field Ctrl+Enter sends the form and Enter alone does nothing", () => {
  const { form, sent } = formWith({});
  expect(press({ key: "Enter" }, form)).toBe(false);
  expect(sent).toEqual([]);
  expect(press({ ctrlKey: true }, form)).toBe(true);
  expect(sent).toHaveLength(1);
});

test("a press that something else already took is not a send", () => {
  const { form, sent } = formWith({});
  submitOnShortcut({
    nativeEvent: { ...keys({ ctrlKey: true }), defaultPrevented: true },
    preventDefault: () => {},
    currentTarget: { form, value: "Hello" },
  } as never);
  expect(sent).toEqual([]);
});

// An editor with the shortcut, and optionally a suggestion list showing `options`.
function editorWith(options = 0) {
  const editor = createEditor({
    onError: (error) => {
      throw error;
    },
  });
  const sent: string[] = [];
  registerSubmitShortcut(editor, () => sent.push("sent"));
  const picked: number[] = [];
  registerSuggestionKeys(editor, () => ({ count: options, active: 0 }), {
    move: () => {},
    pick: (index) => picked.push(index),
    close: () => {},
  });
  return { editor, sent, picked };
}

const enter = (over: Partial<ReturnType<typeof keys>>) => {
  const event = {
    ...keys(over),
    prevented: false,
    preventDefault() {
      event.prevented = true;
    },
    stopPropagation() {},
  };
  return event;
};

test("in the editor Ctrl+Enter sends and the key makes no new paragraph", () => {
  const { editor, sent } = editorWith();
  const event = enter({ ctrlKey: true });
  expect(editor.dispatchCommand(KEY_ENTER_COMMAND, event as never)).toBe(true);
  expect(sent).toHaveLength(1);
  expect(event.prevented).toBe(true);
});

test("in the editor Enter alone is left to the editor", () => {
  const { editor, sent } = editorWith();
  expect(editor.dispatchCommand(KEY_ENTER_COMMAND, enter({}) as never)).toBe(
    false,
  );
  expect(sent).toEqual([]);
});

test("while the mention list shows options, Ctrl+Enter is the list's and sends nothing", () => {
  const { editor, sent, picked } = editorWith(2);
  editor.dispatchCommand(KEY_ENTER_COMMAND, enter({ ctrlKey: true }) as never);
  expect(picked).toEqual([0]);
  expect(sent).toEqual([]);
});
