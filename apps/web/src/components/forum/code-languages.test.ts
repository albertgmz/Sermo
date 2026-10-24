import { expect, test } from "bun:test";
import { renderBbCode } from "../../../../../packages/core/src/render";
import { isCodeLanguage } from "./bb-scan";
import { COMMON_LANGUAGES, OTHER_LANGUAGES } from "./code-languages";

const ALL = [...COMMON_LANGUAGES, ...OTHER_LANGUAGES];

test("the common languages come first, PHP, JavaScript, HTML, CSS and SQL among them", () => {
  const ids = COMMON_LANGUAGES.map((language) => language.id);
  expect(ids.slice(0, 4)).toEqual(["php", "javascript", "html", "css"]);
  expect(ids).toContain("sql");
  expect(ids).toContain("python");
  expect(ids).toContain("bash");
  expect(ids).toContain("json");
  expect(ids).toContain("cpp");
});

test("a language is offered once, and the others are in alphabetical order", () => {
  const ids = ALL.map((language) => language.id);
  expect(new Set(ids).size).toBe(ids.length);
  const names = OTHER_LANGUAGES.map((language) => language.name);
  expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
});

test("every language offered is one the editor writes and the post view highlights", () => {
  for (const { id, name } of ALL) {
    expect(isCodeLanguage(id)).toBe(true);
    const html = renderBbCode(`[CODE=${id}]\nx\n[/CODE]`);
    expect(html).toContain(`<span class="bb-code-lang">${name}</span>`);
    expect(html).toContain('<pre class="hljs language-');
  }
});
