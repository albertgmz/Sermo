import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { withIntl } from "@/lib/test-intl";
import { menuChoices, PrefixSelect } from "./prefix-select";

const PREFIXES = [
  { id: 7, label: "Solved", color: "#22aa66", icon: "circle-check" },
  { id: 9, label: "Question", color: "#3366cc", icon: "" },
];

const draw = (value: string, none: string | null = "(No prefix)") =>
  renderToStaticMarkup(
    withIntl(
      <PrefixSelect
        prefixes={PREFIXES}
        value={value}
        none={none}
        label="Prefix"
        onChange={() => {}}
      />,
    ),
  );

test("the button shows the chosen prefix as its coloured label and is named with it", () => {
  const html = draw("7");
  expect(html).toContain('aria-label="Prefix: Solved"');
  expect(html).toContain('aria-haspopup="menu"');
  expect(html).toContain('aria-expanded="false"');
  // The label's own colour, held to a contrast that reads in both themes (`.ink`).
  expect(html).toContain("--prefix-color:#22aa66");
  expect(html).toContain("--ink:#22aa66");
  expect(html).toMatch(/class="[^"]*\bink\b/);
  expect(html).toContain(">Solved<");
});

test("with none chosen the button says so in muted text", () => {
  const html = draw("");
  expect(html).toContain('aria-label="Prefix: (No prefix)"');
  expect(html).toContain('text-muted-foreground">(No prefix)</span>');
  expect(html).not.toContain("--prefix-color");
});

test("the menu offers the choice of none first, then the prefixes in the forum's order", () => {
  expect(menuChoices(PREFIXES, "(No prefix)").map((c) => c.value)).toEqual([
    "",
    "7",
    "9",
  ]);
  expect(menuChoices(PREFIXES, "(No prefix)")[0].text).toBe("(No prefix)");
  // A thread that must keep its prefix is offered no way to drop it.
  expect(menuChoices(PREFIXES, null).map((c) => c.value)).toEqual(["7", "9"]);
  // Typing a label's first letters finds it.
  expect(menuChoices(PREFIXES, null).map((c) => c.text)).toEqual([
    "Solved",
    "Question",
  ]);
});

test("the menu's code is not part of the page: it comes with the first reach for the button, which the arrow keys open", () => {
  const source = readFileSync(
    join(import.meta.dir, "prefix-select.tsx"),
    "utf8",
  );
  expect(source).toContain('import("@/components/forum/prefix-select-popup")');
  expect(source).toContain('opening="menu"');
  expect(source).not.toMatch(/^import [^;]*@base-ui/m);
});
