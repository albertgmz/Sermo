import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  createEditor,
  type LexicalEditor,
  type TextNode,
} from "lexical";
import { renderToStaticMarkup } from "react-dom/server";
import { mentionInText } from "./editor-commands";
import { mentionBefore, onMentionStart } from "./editor-extras";
import type { MentionHit } from "./mention-find";
import { MentionOption, registerMentionTyping } from "./mention-suggest";

const hit = (fields: Partial<MentionHit>): MentionHit => ({
  id: 1,
  username: "Lucien",
  avatar: null,
  nameColor: null,
  title: "",
  staff: false,
  ...fields,
});

const option = (member: MentionHit, query = "Luc") =>
  renderToStaticMarkup(<MentionOption hit={member} query={query} />);

// The element that holds the member's name: the one around the underlined match.
const nameOf = (html: string) =>
  /<span ([^>]*)><span class="[^"]*underline[^"]*">/.exec(html)?.[1] ?? "";

test("a staff member's name is bold and drawn in their colour, held readable in the theme", () => {
  const name = nameOf(
    option(hit({ staff: true, nameColor: "#cc0000", title: "Administrator" })),
  );
  expect(name).toContain("font-bold");
  expect(name).toContain("ink");
  expect(name).toContain("--ink:#cc0000");
});

test("a member who is not staff keeps the normal weight, and their colour if they have one", () => {
  const plain = nameOf(option(hit({})));
  expect(plain).toContain("font-normal");
  expect(plain).not.toContain("ink");
  const coloured = nameOf(option(hit({ nameColor: "#0000cc" })));
  expect(coloured).toContain("font-normal");
  expect(coloured).toContain("--ink:#0000cc");
});

test("what was typed is underlined at the start of the name, in the name's own colour and weight", () => {
  const html = option(hit({}), "luc");
  // A plain span: it takes the name's colour and weight, and is not read as emphasis.
  expect(html).toMatch(/<span class="[^"]*underline[^"]*">Luc<\/span>ien/);
  expect(html).not.toContain("<strong");
});

test("the title goes on a second line, and a member without one has none", () => {
  expect(option(hit({ title: "Administrator" }))).toContain(
    ">Administrator</span>",
  );
  expect(option(hit({}))).not.toContain("text-xs text-muted-foreground");
  // Two lines keep a little room above and below in a 36 px row.
  expect(option(hit({ title: "Administrator" }))).toContain(
    '<span class="min-w-0 py-1">',
  );
  expect(option(hit({}))).toContain('<span class="min-w-0">');
});

test("the avatar is the member's small picture, or their initials", () => {
  const pictured = option(hit({ avatar: "/files/10" }));
  expect(pictured).toContain('src="/files/10"');
  expect(pictured).toContain('alt=""');
  const initials = option(hit({}));
  expect(initials).not.toContain("<img");
  expect(initials).toContain('data-initials="Lu"');
});

// A headless editor holding `text` in one paragraph, the caret at its end.
function editorWith(text: string) {
  const editor = createEditor({
    onError: (error) => {
      throw error;
    },
  });
  editor.update(
    () => {
      const node = $createTextNode(text);
      $getRoot().clear().append($createParagraphNode().append(node));
      node.select(text.length, text.length);
    },
    { discrete: true },
  );
  return editor;
}

function type(editor: LexicalEditor, more: string) {
  editor.update(
    () => {
      const node = $getRoot().getFirstDescendant() as TextNode;
      const text = node.getTextContent();
      node.setTextContent(text + more);
      node.select(text.length + more.length, text.length + more.length);
    },
    { discrete: true },
  );
}

test("the listener reads what was typed before the list arrived, then each change", () => {
  const editor = editorWith("hola @Lu");
  const seen: (string | null)[] = [];
  registerMentionTyping(editor, (typed) => seen.push(typed));
  type(editor, "c");
  type(editor, " ");
  expect(seen).toEqual(["Lu", "Luc", null]);
});

test("the list is asked for when a name starts after an @, once per name", () => {
  let asked = 0;
  const typed = onMentionStart(() => asked++);
  typed(null);
  typed("L");
  typed("Lu");
  typed("Luc");
  expect(asked).toBe(1);
  typed(null);
  typed("w");
  expect(asked).toBe(2);
});

test("the member list is not part of the editor's first load", () => {
  const read = (name: string) =>
    readFileSync(join(import.meta.dir, name), "utf8");
  const statics = (source: string) =>
    [...source.matchAll(/^import(?! type)[^;]*?from "([^"]+)";/gm)].map(
      (found) => found[1],
    );
  for (const name of ["editor.tsx", "editor-extras.tsx"]) {
    for (const from of statics(read(name))) {
      expect(from).not.toMatch(/mention-suggest|suggestion-list|ui\/avatar/);
    }
  }
  expect(read("editor-extras.tsx")).toContain(
    '() => import("@/components/forum/mention-suggest")',
  );
});

test("in the source field the name typed is read from the text before the caret", () => {
  expect(mentionBefore("hola @Lu")).toBe("Lu");
  expect(mentionBefore("@ab")).toBe("ab");
  expect(mentionBefore("(@ab")).toBe("ab");
  expect(mentionBefore("mail@ab")).toBeNull();
  expect(mentionBefore("hola @")).toBeNull();
  expect(mentionBefore("hola @Lucien y")).toBeNull();
});

test("a member picked in the source field replaces the @ and the name typed, with a space after", () => {
  expect(mentionInText("hola @ab", 8, "@abel")).toEqual({
    text: "hola @abel ",
    caret: 11,
  });
  // The text that goes on after the caret is kept, and a space there is not doubled.
  expect(mentionInText("hola @ab y más", 8, "@abel")).toEqual({
    text: "hola @abel y más",
    caret: 10,
  });
  expect(mentionInText("@ab\nfin", 3, '@"Abel Ruiz"')).toEqual({
    text: '@"Abel Ruiz"\nfin',
    caret: 12,
  });
});
