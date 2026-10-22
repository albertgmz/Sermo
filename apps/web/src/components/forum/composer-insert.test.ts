import { expect, test } from "bun:test";
import {
  attachTag,
  insertAtCaret,
  insertIntoComposer,
  onComposerRequest,
  onImagePick,
  pickImage,
  removeFromComposer,
  takePastedFiles,
  withoutAttachTag,
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
  const got: unknown[] = [];
  const stopMine = onComposerRequest(mine.form, (request) =>
    got.push(["mine", request]),
  );
  onComposerRequest(other.form, (request) => got.push(["other", request]));
  insertIntoComposer(mine.inside, "[ATTACH]1[/ATTACH]");
  removeFromComposer(mine.inside, 1);
  insertIntoComposer(mine.inside, "[ATTACH=full]2[/ATTACH]", true);
  expect(got).toEqual([
    ["mine", { insert: "[ATTACH]1[/ATTACH]" }],
    ["mine", { remove: 1 }],
    ["mine", { insert: "[ATTACH=full]2[/ATTACH]", background: true }],
  ]);
  stopMine();
  insertIntoComposer(mine.inside, "again");
  expect(got).toHaveLength(3);
});

test("removing an attachment takes out its tags of both sizes and no other's", () => {
  const text =
    "a [ATTACH]1[/ATTACH] b [ATTACH=full]1[/ATTACH] c [ATTACH]12[/ATTACH] [ATTACH]21[/ATTACH]";
  expect(withoutAttachTag(text, 1)).toBe(
    "a  b  c [ATTACH]12[/ATTACH] [ATTACH]21[/ATTACH]",
  );
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

test("a field that never had the focus takes the text at its end", () => {
  const calls: unknown[][] = [];
  const field = {
    value: "hello",
    selectionStart: 0,
    selectionEnd: 0,
    setSelectionRange: (...args: unknown[]) => {
      calls.push(["range", ...args]);
      field.selectionStart = 5;
      field.selectionEnd = 5;
    },
    setRangeText: (...args: unknown[]) => calls.push(args),
    focus: () => {},
  };
  insertAtCaret(field as unknown as HTMLTextAreaElement, "x", false);
  expect(calls).toEqual([
    ["range", 5, 5],
    ["x", 5, 5, "end"],
  ]);
});

test("removing an attachment also takes the thumb form and the spaced and quoted ones", () => {
  const text = [
    "[ATTACH=thumb]6[/ATTACH]",
    "[attach] 6 [/attach]",
    "[ATTACH= full ]6[/ATTACH]",
    '[ATTACH="thumb"]6[/ATTACH]',
    "[ATTACH=small]6[/ATTACH]",
    "[ATTACH]66[/ATTACH]",
  ].join("|");
  expect(withoutAttachTag(text, 6)).toBe(
    "||||[ATTACH=small]6[/ATTACH]|[ATTACH]66[/ATTACH]",
  );
});

test("the Image button reaches the picture picker of its own composer, and says when there is none", () => {
  const mine = composer();
  const other = composer();
  const opened: string[] = [];
  const stop = onImagePick(mine.form, () => opened.push("mine"));
  onImagePick(other.form, () => opened.push("other"));
  expect(pickImage(mine.form)).toBe(true);
  expect(opened).toEqual(["mine"]);
  stop();
  expect(pickImage(mine.form)).toBe(false);
  expect(pickImage(null)).toBe(false);
  expect(opened).toEqual(["mine"]);
});

function paste(files: File[], text = "") {
  const { form } = composer();
  const got: unknown[] = [];
  onComposerRequest(form, (request) => got.push(request));
  let prevented = false;
  takePastedFiles({
    clipboardData: {
      files,
      types: files.length ? ["Files"] : [],
      getData: (type: string) => (type === "text/plain" ? text : ""),
    } as unknown as DataTransfer,
    currentTarget: { form },
    preventDefault: () => {
      prevented = true;
    },
  });
  return { got, prevented };
}

test("files pasted into a plain field of the composer go to the editor as pasted files, and the field takes none", () => {
  const files = [new File(["x"], "image.png", { type: "image/png" })];
  expect(paste(files)).toEqual({
    got: [{ drop: files, pasted: true }],
    prevented: true,
  });
});

test("a paste of text into a plain field is left alone", () => {
  expect(paste([], "hello")).toEqual({ got: [], prevented: false });
});
