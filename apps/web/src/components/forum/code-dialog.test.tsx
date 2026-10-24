import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { Dialog } from "@/components/ui/dialog";
import { messages } from "@/i18n/messages";
import { withIntl } from "@/lib/test-intl";
import { CodeDialogBody, textFocus } from "./code-dialog";
import { Toolbar } from "./editor-toolbar";

const text = messages.editor.editor;
const none = () => {};

// What the dialog holds, over a code block of `current` or for a new one (null). The box that keeps
// it over the page is drawn in a portal, which markup rendered on the server does not hold.
const body = (current: string | null) =>
  renderToStaticMarkup(
    withIntl(
      <Dialog open>
        <CodeDialogBody
          current={current}
          onInsert={none}
          onChange={none}
          onRemove={none}
          onFinish={none}
        />
      </Dialog>,
    ),
  );

const optionsOf = (html: string) =>
  [...html.matchAll(/<option value="([^"]*)"( selected="")?>([^<]*)</g)].map(
    ([, value, selected, label]) => ({ value, selected: !!selected, label }),
  );

test("the dialog that puts code in asks for the language, General code first and chosen, and for the code", () => {
  const html = body(null);
  expect(html).toContain(`>${text.codeInsertTitle}</h2>`);
  expect(html).toMatch(
    new RegExp(
      `<label[^>]*for="([^"]+)-language"[^>]*>${text.codeLanguageLabel}<`,
    ),
  );
  const options = optionsOf(html);
  expect(options[0]).toEqual({
    value: "",
    selected: true,
    label: text.codeGeneral,
  });
  expect(options.slice(1, 5).map((option) => option.value)).toEqual([
    "php",
    "javascript",
    "html",
    "css",
  ]);
  expect(options.filter((option) => option.selected)).toHaveLength(1);
  expect(html).toContain(`<optgroup label="${text.codeCommonLanguages}">`);
  expect(html).toContain(`<optgroup label="${text.codeOtherLanguages}">`);
  expect(html).toMatch(
    new RegExp(`<label[^>]*for="[^"]+-code"[^>]*>${text.codeLabel}<`),
  );
  expect(html).toContain("<textarea");
  expect(html).toContain(`>${text.codeInsert}</button>`);
  expect(html).not.toContain(text.codeRemove);
});

test("over a code block the dialog shows its language and no code, and can change it or remove the block", () => {
  const html = body("sql");
  expect(html).toContain(`>${text.codeChangeTitle}</h2>`);
  expect(optionsOf(html).find((option) => option.selected)?.value).toBe("sql");
  expect(html).not.toContain("<textarea");
  expect(html).toContain(`>${text.codeApply}</button>`);
  expect(html).toContain(`>${text.codeRemove}</button>`);
  expect(html).toContain(`>${text.codeCancel}</button>`);
});

test("a block of a language the dialog does not list keeps it as the chosen one", () => {
  const options = optionsOf(body("ts"));
  expect(options.find((option) => option.value === "ts")).toEqual({
    value: "ts",
    selected: true,
    label: "ts",
  });
  expect(options.filter((option) => option.selected)).toHaveLength(1);
});

test("General code is the chosen one over a block that has no language", () => {
  expect(optionsOf(body("")).find((option) => option.selected)?.value).toBe("");
});

test("the dialog's code is not drawn with the bar: the code button is a plain button until it is pressed", () => {
  const html = renderToStaticMarkup(withIntl(<Toolbar />));
  expect(html).toContain(`aria-label="${text.codeBlockLabel}"`);
  expect(html).not.toContain(text.codeInsertTitle);
  expect(html).not.toContain('role="dialog"');
});

test("the bar fetches the dialog's code when the code button is pressed, and imports none of it", () => {
  const bar = readFileSync(join(import.meta.dir, "editor-toolbar.tsx"), "utf8");
  expect(bar).toContain('import("@/components/forum/code-dialog")');
  expect(bar).not.toMatch(
    /^import (?!type)[^;]*from "@\/components\/forum\/code-(dialog|languages)"/m,
  );
});

test("however the dialog is closed, the focus goes back to the text and not to the button that opened it", () => {
  let restored = 0;
  const finalFocus = textFocus(() => restored++);
  // Base UI moves the focus itself unless the answer is false.
  expect(finalFocus()).toBe(false);
  expect(finalFocus()).toBe(false);
  expect(restored).toBe(2);
});
