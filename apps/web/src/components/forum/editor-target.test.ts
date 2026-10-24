import { expect, test } from "bun:test";
import { $toggleLink, TOGGLE_LINK_COMMAND } from "@lexical/link";
import { registerList } from "@lexical/list";
import { registerRichText } from "@lexical/rich-text";
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  CAN_UNDO_COMMAND,
  COMMAND_PRIORITY_LOW,
  createEditor,
  type LexicalEditor,
  REDO_COMMAND,
  UNDO_COMMAND,
} from "lexical";
import { $exportBb, $replaceWithBb, BB_NODES } from "./bb-lexical";
import { replay, toolbarTarget } from "./editor-target";
import type { ToolbarAction, ToolbarState } from "./toolbar-context";

// An editor holding one paragraph of `text`, with `from`..`to` selected, wired like the real one.
function editorWith(text: string, from = 0, to = text.length) {
  const editor = createEditor({
    nodes: BB_NODES,
    onError: (error) => {
      throw error;
    },
  });
  registerRichText(editor);
  registerList(editor);
  // What the editor's LinkPlugin does with the command.
  editor.registerCommand(
    TOGGLE_LINK_COMMAND,
    (url) => {
      $toggleLink(typeof url === "string" || url === null ? url : url.url);
      return true;
    },
    COMMAND_PRIORITY_LOW,
  );
  editor.update(
    () => {
      const node = $createTextNode(text);
      $getRoot().clear().append($createParagraphNode().append(node));
      node.select(from, to);
    },
    { discrete: true },
  );
  return editor;
}

// The BB code once every change asked for is in.
async function bbOf(editor: LexicalEditor) {
  await Promise.resolve();
  return editor.getEditorState().read($exportBb);
}

const targetOf = (editor: LexicalEditor, toggled: string[] = []) =>
  toolbarTarget(editor, () => toggled.push("source"));

test("each press of the bar does to the text what its button says", async () => {
  const cases: [ToolbarAction, string][] = [
    [{ format: "bold" }, "[B]word[/B]"],
    [{ format: "italic" }, "[I]word[/I]"],
    [{ block: "heading" }, "[HEADING=2]word[/HEADING]"],
    [{ block: "quote" }, "[QUOTE]word[/QUOTE]"],
    [{ block: "code" }, "[CODE]\nword\n[/CODE]"],
    [{ list: "bullet" }, "[LIST]\n[*]word\n[/LIST]"],
    [{ list: "number" }, "[LIST=1]\n[*]word\n[/LIST]"],
    [{ link: "https://x.test/" }, "[URL=https://x.test/]word[/URL]"],
    [{ insert: "[MEDIA=youtube]abc[/MEDIA]" }, "[MEDIA=youtube]abc[/MEDIA]"],
    [{ wrap: ["[SPOILER]", "[/SPOILER]"] }, "[SPOILER]word[/SPOILER]"],
  ];
  for (const [action, bb] of cases) {
    const editor = editorWith("word");
    targetOf(editor).run(action);
    expect({ action, bb: await bbOf(editor) }).toEqual({ action, bb });
  }
});

test("a press on a block or a list that is on already turns it off, read from the text itself", async () => {
  for (const action of [
    { block: "heading" },
    { block: "quote" },
    { list: "bullet" },
    { list: "number" },
  ] as ToolbarAction[]) {
    const editor = editorWith("word");
    const target = targetOf(editor);
    target.run(action);
    await bbOf(editor);
    target.run(action);
    expect({ action, bb: await bbOf(editor) }).toEqual({ action, bb: "word" });
  }
});

test("taking off a link, removing the formatting, Undo, Redo and the BB code source", async () => {
  const linked = editorWith("word");
  const target = targetOf(linked);
  target.run({ link: "https://x.test/" });
  await bbOf(linked);
  target.run({ link: null });
  expect(await bbOf(linked)).toBe("word");

  const bold = editorWith("word");
  targetOf(bold).run({ format: "bold" });
  await bbOf(bold);
  targetOf(bold).run({ run: "removeFormatting" });
  expect(await bbOf(bold)).toBe("word");

  const asked: string[] = [];
  const history = editorWith("word");
  history.registerCommand(
    UNDO_COMMAND,
    () => asked.push("undo") > 0,
    COMMAND_PRIORITY_LOW,
  );
  history.registerCommand(
    REDO_COMMAND,
    () => asked.push("redo") > 0,
    COMMAND_PRIORITY_LOW,
  );
  const toggled: string[] = [];
  const source = targetOf(history, toggled);
  source.run({ run: "undo" });
  source.run({ run: "redo" });
  source.run({ run: "source" });
  expect(asked).toEqual(["undo", "redo"]);
  expect(toggled).toEqual(["source"]);
  // An editor that is not in a page is in no form.
  expect(source.form()).toBeNull();
  expect(source.ready).toBe(true);
});

test("the bar is told where the caret is and whether there is something to undo", async () => {
  const editor = editorWith("word");
  const seen: Partial<ToolbarState>[] = [];
  const stop = targetOf(editor).watch((state) => seen.push(state));
  targetOf(editor).run({ format: "bold" });
  await bbOf(editor);
  expect(seen.at(-1)).toEqual({
    formats: ["bold"],
    block: "paragraph",
    link: false,
  });
  editor.dispatchCommand(CAN_UNDO_COMMAND, true);
  expect(seen.at(-1)).toEqual({ canUndo: true });
  stop();
  const count = seen.length;
  editor.dispatchCommand(CAN_UNDO_COMMAND, false);
  expect(seen.length).toBe(count);
});

test("presses kept while the editor was on its way are applied in order, once", async () => {
  const editor = editorWith("word");
  const pressed: ToolbarAction[] = [{ format: "bold" }, { list: "bullet" }];
  replay(targetOf(editor), pressed);
  expect(await bbOf(editor)).toBe("[LIST]\n[*][B]word[/B]\n[/LIST]");
  expect(pressed).toEqual([]);
  replay(targetOf(editor), pressed);
  expect(await bbOf(editor)).toBe("[LIST]\n[*][B]word[/B]\n[/LIST]");
});

test("the code dialog turns the selected text into a code block of the chosen language, or of none", async () => {
  const cases: [string, string][] = [
    ["php", "[CODE=php]\nword\n[/CODE]"],
    ["c++", "[CODE=c++]\nword\n[/CODE]"],
    ["", "[CODE]\nword\n[/CODE]"],
  ];
  for (const [language, bb] of cases) {
    const editor = editorWith("word");
    targetOf(editor).run({ code: { language, text: "" } });
    expect({ language, bb: await bbOf(editor) }).toEqual({ language, bb });
  }
});

test("code typed in the code dialog goes in after the text it was pressed in, as a block of its language", async () => {
  const editor = editorWith("word", 4, 4);
  targetOf(editor).run({
    code: { language: "python", text: "print(1)\nprint(2)" },
  });
  expect(await bbOf(editor)).toBe(
    "word\n\n[CODE=python]\nprint(1)\nprint(2)\n[/CODE]",
  );
});

test("the language of a code block changes from the dialog, and General code takes the option off", async () => {
  const editor = editorWith("word");
  const target = targetOf(editor);
  target.run({ code: { language: "php", text: "" } });
  await bbOf(editor);
  target.run({ codeLanguage: "sql" });
  expect(await bbOf(editor)).toBe("[CODE=sql]\nword\n[/CODE]");
  target.run({ codeLanguage: "" });
  expect(await bbOf(editor)).toBe("[CODE]\nword\n[/CODE]");
});

test("the bar is told the language of the code block the caret is in", async () => {
  const editor = editorWith("word");
  const seen: Partial<ToolbarState>[] = [];
  targetOf(editor).watch((state) => seen.push(state));
  targetOf(editor).run({ code: { language: "php", text: "" } });
  await bbOf(editor);
  expect(seen.at(-1)).toMatchObject({ block: "code", codeLanguage: "php" });
  targetOf(editor).run({ block: "code" });
  await bbOf(editor);
  expect(seen.at(-1)?.block).toBe("paragraph");
  expect(seen.at(-1)?.codeLanguage).toBeUndefined();
});

test("code in the middle of a paragraph splits it around the block; a block read from BB code reports its language and takes a new one", async () => {
  const split = editorWith("hello world", 5, 5);
  targetOf(split).run({ code: { language: "", text: "x = 1" } });
  expect(await bbOf(split)).toBe("hello\n\n[CODE]\nx = 1\n[/CODE]\n\nworld");

  const read = editorWith("");
  read.update(() => $replaceWithBb("[CODE=php]\necho 1;\n[/CODE]"), {
    discrete: true,
  });
  read.update(() => $getRoot().getFirstChild()?.selectStart(), {
    discrete: true,
  });
  const seen: Partial<ToolbarState>[] = [];
  targetOf(read).watch((state) => seen.push(state));
  targetOf(read).run({ codeLanguage: "python" });
  expect(await bbOf(read)).toBe("[CODE=python]\necho 1;\n[/CODE]");
  expect(seen.at(-1)).toMatchObject({ block: "code", codeLanguage: "python" });
});
