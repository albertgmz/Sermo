import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  createEditor,
} from "lexical";
import { renderToStaticMarkup } from "react-dom/server";
import { messages } from "@/i18n/messages";
import { withIntl } from "@/lib/test-intl";
import EmojiPicker, {
  insertChoice,
  pickerSections,
  registerPicker,
  resultSection,
  withRecent,
} from "./emoji-picker";

const text = messages.editor.editor;
const NAMES = {
  recent: "Recent",
  smilies: "Smilies",
  group: (key: string) => key,
};
const LAUGH = {
  id: 17,
  title: "Laugh",
  codes: [":LOL:", ":lol2:"],
  emoji: "😆",
};

const picker = () => (
  <LexicalComposer
    initialConfig={{
      namespace: "test",
      onError: (error) => {
        throw error;
      },
    }}
  >
    <EmojiPicker focusSearch={false} onClose={() => {}} />
  </LexicalComposer>
);

test("the picker is a labelled group: search, skin tone, categories and one labelled listbox per section", () => {
  const html = renderToStaticMarkup(withIntl(picker()));
  expect(html).toContain(`<fieldset aria-label="${text.emojiPickerLabel}"`);
  expect(html).toContain(`type="search"`);
  expect(html).toContain(`aria-label="${text.emojiSearch}"`);
  expect(html).toContain(`aria-label="${text.emojiTone}"`);
  expect(html.match(/<option /g)).toHaveLength(6);
  expect(html).toContain(`<nav aria-label="${text.emojiCategories}"`);
  for (const title of Object.values(text.emojiGroups)) {
    expect(html).toContain(`aria-label="${title.replace("&", "&amp;")}"`);
  }
  const listboxes = html.match(
    /role="listbox" aria-labelledby="[^"]+-[a-z-]+"/g,
  );
  expect(listboxes).toHaveLength(9);
  expect(html).toContain(
    'role="option" aria-selected="false" tabindex="-1" aria-label="grinning face" title="grinning face"',
  );
  expect(html.match(/role="option"/g)?.length).toBeGreaterThan(1800);
});

test("two pickers on one page label their sections with headings of their own", () => {
  const html = renderToStaticMarkup(
    withIntl(
      <>
        {picker()}
        {picker()}
      </>,
    ),
  );
  const ids = [...html.matchAll(/<h3 id="([^"]+)"/g)].map((found) => found[1]);
  expect(ids).toHaveLength(18);
  expect(new Set(ids).size).toBe(18);
  for (const [, labelled] of html.matchAll(/aria-labelledby="([^"]+)"/g))
    expect(ids).toContain(labelled);
});

test("each category of the jump row has its own fixed icon, and the grid is lower on a phone", () => {
  const html = renderToStaticMarkup(withIntl(picker()));
  const nav = html.slice(html.indexOf("<nav"), html.indexOf("</nav>"));
  const buttons = [...nav.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)];
  expect(buttons).toHaveLength(9);
  const icons = buttons.map(
    ([, inner]) => inner.match(/lucide-([a-z-]+)/)?.[1],
  );
  expect(icons).toEqual([
    "face-grinning",
    "person-standing",
    "paw-print",
    "utensils",
    "car",
    "volleyball",
    "lightbulb",
    "heart",
    "flag",
  ]);
  expect(html).toContain("h-32 overflow-y-auto sm:h-56");
});

test("recently used come first, then the smilies, then the emoji by group, in the chosen skin tone", () => {
  const sections = pickerSections(
    ["👋🏽", ":lol2:", "🔥", "gone"],
    [LAUGH],
    3,
    "es",
    NAMES,
  );
  expect(sections.map((section) => section.id).slice(0, 3)).toEqual([
    "recent",
    "smilies",
    "smileys-emotion",
  ]);
  expect(sections[0].choices).toEqual([
    { text: "👋🏽", glyph: "👋🏽", label: "mano saludando" },
    { text: ":lol2:", glyph: "😆", label: "Laugh :LOL:" },
    { text: "🔥", glyph: "🔥", label: "fuego" },
  ]);
  expect(sections[1].choices).toEqual([
    { text: ":LOL:", glyph: "😆", label: "Laugh :LOL:" },
  ]);
  const people = sections.find((section) => section.id === "people-body");
  expect(
    people?.choices.find((choice) => choice.label === "mano saludando")?.text,
  ).toBe("👋🏽");
});

test("without recent picks or smilies those sections are left out", () => {
  const sections = pickerSections([], [], 0, "en", NAMES);
  expect(sections[0].id).toBe("smileys-emotion");
  expect(
    sections[1].choices.find((choice) => choice.label === "waving hand")?.text,
  ).toBe("👋");
});

test("a pick goes first in the recent list, once, and the list keeps its 24 newest", () => {
  expect(withRecent(["a", "b", "c"], "b")).toEqual(["b", "a", "c"]);
  const full = Array.from({ length: 24 }, (_, index) => String(index));
  expect(withRecent(full, "new")).toEqual(["new", ...full.slice(0, 23)]);
});

test("the picker is no part of the editor's first load", () => {
  const source = readFileSync(
    join(import.meta.dir, "editor-toolbar.tsx"),
    "utf8",
  );
  const statics = [...source.matchAll(/^import[^;]*?from "([^"]+)";/gm)].map(
    (found) => found[1],
  );
  for (const from of statics) {
    expect(from).not.toMatch(/emoji-picker|emoji-find|emojibase|smilie/);
  }
  expect(source).toContain('import("@/components/forum/emoji-picker")');
});

// The picker's keys wired to its parts as the component wires them, over a real (headless) editor:
// the search box is where the key is pressed, and its listener is the picker's.
function searchIn(query: string) {
  const editor = createEditor({
    onError: (error) => {
      throw error;
    },
  });
  editor.update(
    () => {
      const node = $createTextNode("hola ");
      $getRoot().clear().append($createParagraphNode().append(node));
      node.select(5, 5);
    },
    { discrete: true },
  );
  const search = new EventTarget();
  let caret = null as Parameters<typeof insertChoice>[2];
  const sections = query.trim()
    ? [resultSection(query, "en", [LAUGH], "Results")]
    : pickerSections([], [LAUGH], 0, "en", NAMES);
  registerPicker(search, {
    search: () => search,
    options: () => [],
    query: () => query,
    sections: () => sections,
    pick: (choice) => {
      caret = insertChoice(editor, choice.text, caret);
    },
    close: () => {},
  });
  const enter = async () => {
    const event = new Event("keydown", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "key", { value: "Enter" });
    search.dispatchEvent(event);
    await Promise.resolve();
    return {
      prevented: event.defaultPrevented,
      text: editor.getEditorState().read(() => $getRoot().getTextContent()),
    };
  };
  return { enter };
}

test("Enter in the search box puts the first result in at the caret and sends nothing", async () => {
  expect(await searchIn("thinking").enter()).toEqual({
    prevented: true,
    text: "hola 🤔",
  });
  expect(await searchIn("laugh").enter()).toEqual({
    prevented: true,
    text: "hola :LOL:",
  });
});

test("Enter in the empty search box sends nothing and puts nothing in", async () => {
  expect(await searchIn("  ").enter()).toEqual({
    prevented: true,
    text: "hola ",
  });
});
