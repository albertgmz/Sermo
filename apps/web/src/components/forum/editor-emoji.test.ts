import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { $createCodeNode, CodeNode } from "@lexical/code";
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  createEditor,
  HISTORIC_TAG,
  type LexicalEditor,
  type TextNode,
} from "lexical";
import {
  $emojiTyped,
  emojiTyped,
  loader,
  shortcodeStarted,
} from "./editor-emoji";
import { $replaceTyped, registerEmojiTyping } from "./emoji-suggest";

test("a colon that starts a word opens a shortcode, with what follows it", () => {
  expect(emojiTyped(":")).toEqual({ query: "", closed: false, length: 1 });
  expect(emojiTyped("hola :think")).toEqual({
    query: "think",
    closed: false,
    length: 6,
  });
  expect(emojiTyped("(:+1")?.query).toBe("+1");
  expect(emojiTyped("🔥:fire")?.query).toBe("fire");
  expect(emojiTyped("👍️:ok")?.query).toBe("ok");
});

test("a colon after a letter or a number, or one followed by a space or a symbol, opens nothing", () => {
  for (const text of [
    "10:30",
    "http:",
    "http://",
    "Nota:",
    "a :)",
    ": ",
    "::",
  ]) {
    expect(emojiTyped(text)).toBeNull();
  }
});

test("a second colon closes the shortcode", () => {
  expect(emojiTyped("mira :thinking:")).toEqual({
    query: "thinking",
    closed: true,
    length: 10,
  });
});

// A headless editor holding `text` in one paragraph (or a code block), the caret at its end.
function editorWith(text: string, code = false) {
  const editor = createEditor({
    nodes: [CodeNode],
    onError: (error) => {
      throw error;
    },
  });
  editor.update(
    () => {
      const node = $createTextNode(text);
      const block = code ? $createCodeNode() : $createParagraphNode();
      $getRoot().clear().append(block.append(node));
      node.select(text.length, text.length);
    },
    { discrete: true },
  );
  return editor;
}

const textOf = (editor: LexicalEditor) =>
  editor.getEditorState().read(() => $getRoot().getTextContent());

// Types `more` at the caret, as a key press would.
function type(editor: LexicalEditor, more: string, tag?: string) {
  editor.update(
    () => {
      const node = $getRoot().getFirstDescendant() as TextNode;
      const text = node.getTextContent();
      node.setTextContent(text + more);
      node.select(text.length + more.length, text.length + more.length);
    },
    { discrete: true, tag },
  );
}

test("no shortcode is read in code", () => {
  expect(editorWith("x :think", true).read($emojiTyped)).toBeNull();
  const inline = editorWith("x :think");
  inline.update(
    () => {
      ($getRoot().getFirstDescendant() as TextNode).toggleFormat("code");
    },
    { discrete: true },
  );
  expect(inline.getEditorState().read($emojiTyped)).toBeNull();
  expect(editorWith("x :think").getEditorState().read($emojiTyped)?.query).toBe(
    "think",
  );
});

test("closing a known shortcode turns it into its emoji, and an unknown one stays as typed", async () => {
  const editor = editorWith("mira :thinking");
  registerEmojiTyping(editor, () => {});
  type(editor, ":");
  await Promise.resolve();
  expect(textOf(editor)).toBe("mira 🤔");
  type(editor, " y :nada:");
  await Promise.resolve();
  expect(textOf(editor)).toBe("mira 🤔 y :nada:");
});

test("a shortcode Undo puts back is left as it is", async () => {
  const editor = editorWith("mira :thinking");
  registerEmojiTyping(editor, () => {});
  type(editor, ":", HISTORIC_TAG);
  await Promise.resolve();
  expect(textOf(editor)).toBe("mira :thinking:");
});

test("the listener says what is being typed, and nothing once it is closed", () => {
  const editor = editorWith("hola");
  const seen: (string | null)[] = [];
  registerEmojiTyping(editor, (typed) => seen.push(typed?.query ?? null));
  type(editor, " :pe");
  type(editor, "nsa");
  type(editor, " ");
  expect(seen).toEqual([null, "pe", "pensa", null]);
});

test("a picked emoji takes the place of the shortcode, followed by one space", () => {
  const editor = editorWith("hola :pensa");
  editor.update(() => $replaceTyped(6, "🤔", true), { discrete: true });
  expect(textOf(editor)).toBe("hola 🤔 ");
  const before = editorWith("hola :pensa");
  before.update(
    () => {
      const node = $getRoot().getFirstDescendant() as TextNode;
      node.setTextContent("hola :pensa amigo");
      node.select(11, 11);
    },
    { discrete: true },
  );
  before.update(() => $replaceTyped(6, "🤔", true), { discrete: true });
  expect(textOf(before)).toBe("hola 🤔 amigo");
});

test("the emoji list and its data are not part of the editor's first load", () => {
  const read = (name: string) =>
    readFileSync(join(import.meta.dir, name), "utf8");
  const statics = (source: string) =>
    [...source.matchAll(/^import[^;]*?from "([^"]+)";/gm)].map(
      (found) => found[1],
    );
  for (const name of ["editor.tsx", "editor-emoji.tsx"]) {
    for (const from of statics(read(name))) {
      expect(from).not.toMatch(/emoji-suggest|emoji-find|emojibase/);
    }
  }
  expect(read("editor-emoji.tsx")).toContain(
    '() => import("@/components/forum/emoji-suggest")',
  );
});

test("what was typed before the list arrived is read as soon as it starts", async () => {
  const open = editorWith("hola :think");
  const seen: (string | null)[] = [];
  registerEmojiTyping(open, (typed) => seen.push(typed?.query ?? null));
  expect(seen).toEqual(["think"]);
  const closed = editorWith("hola :thinking:");
  registerEmojiTyping(closed, () => {});
  await Promise.resolve();
  expect(textOf(closed)).toBe("hola 🤔");
});

test("the list is asked for once a letter or a number follows the colon, never for an emoticon", () => {
  const asks = (text: string) => shortcodeStarted(emojiTyped(text));
  expect(asks(":")).toBe(false);
  expect(asks(":-")).toBe(false);
  expect(asks("hola :)")).toBe(false);
  expect(asks(":t")).toBe(true);
  expect(asks(":+1")).toBe(true);
});

test("a load that fails is asked for again on the next call, and one that worked is not", async () => {
  const results = [Promise.reject(new Error("gone")), Promise.resolve("list")];
  let calls = 0;
  const done: string[] = [];
  const ask = loader(
    () => results[calls++],
    (loaded) => done.push(loaded),
  );
  ask();
  ask();
  expect(calls).toBe(1);
  await Promise.resolve();
  await Promise.resolve();
  ask();
  await Promise.resolve();
  ask();
  expect(calls).toBe(2);
  expect(done).toEqual(["list"]);
});
