import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { withIntl } from "@/lib/test-intl";
import { ThreadFields } from "./thread-fields";

const PREFIXES = [
  { id: 7, label: "Solved", color: "#22aa66", icon: "circle-check" },
];

const draw = (mustHavePrefix: boolean, prefixId: string) =>
  renderToStaticMarkup(
    withIntl(
      <ThreadFields
        prefixes={PREFIXES}
        prefixId={prefixId}
        title="A title"
        mustHavePrefix={mustHavePrefix}
      />,
    ),
  );

test("the form offers 'No prefix' unless the forum does not let the author take the prefix off", () => {
  expect(draw(false, "")).toContain("No prefix");
  expect(draw(false, "7")).not.toContain("No prefix");
  // The choice that is not there cannot be the one shown.
  expect(draw(true, "7")).not.toContain("No prefix");
  expect(draw(true, "7")).toContain("Solved");
});

test("the prefix is a menu joined to the left of the title, in one field, as XenForo's title row", () => {
  const html = draw(false, "7");
  const group = html.indexOf("focus-within:ring-3");
  const prefix = html.indexOf('aria-label="Prefix: Solved"');
  const title = html.indexOf('name="title"');
  expect(group).toBeGreaterThan(-1);
  expect(group).toBeLessThan(prefix);
  expect(prefix).toBeLessThan(title);
  expect(html).toContain('aria-haspopup="menu"');
  // The chosen prefix is drawn as its coloured label in the button.
  expect(html).toContain("--prefix-color:#22aa66");
  // What the form sends.
  expect(html).toContain('type="hidden" name="prefixId" value="7"');
  expect(html).toContain('value="A title"');
});

test("a forum that offers no prefix draws the title alone, and the form keeps sending no prefix", () => {
  const html = renderToStaticMarkup(
    withIntl(<ThreadFields prefixes={[]} title="A title" />),
  );
  expect(html).not.toContain('aria-haspopup="menu"');
  expect(html).toContain('type="hidden" name="prefixId" value=""');
  expect(html).toContain('placeholder="Title…"');
});

// An input is as wide as its `size` (20 characters) unless told otherwise, and a grid or flex item
// is never narrower than what it holds: the thread's edit dialog ran past a 320 px phone with it.
test("the title row shrinks to its container, however narrow, in the thread's dialog too", () => {
  const input =
    draw(false, "7").match(/<input[^>]*name="title"[^>]*>/)?.[0] ?? "";
  for (const name of ["w-full", "min-w-0", "flex-1"])
    expect(input).toMatch(new RegExp(`class="[^"]*\\b${name}\\b`));
  const dialog = readFileSync(
    join(
      import.meta.dir,
      "../../app/[locale]/(main)/threads/[id]/edit-thread-popup.tsx",
    ),
    "utf8",
  );
  expect(dialog).toMatch(/<form[^>]*className="grid min-w-0 gap-4"/);
});

test("the thread's edit dialog is wide enough for a whole title, and its prefix button stays compact", () => {
  // The shell the thread's and the conversation's Edit dialogs share.
  const shell = readFileSync(join(import.meta.dir, "edit-dialog.tsx"), "utf8");
  expect(shell).toContain('<DialogContent className="sm:max-w-2xl">');
  // The prefix button never takes more than 12rem of the row, whatever the dialog's width.
  expect(draw(false, "7")).toContain("max-w-[min(45%,12rem)]");
});

test("the +18 mark is offered where it may be changed, with the mark it opened with, and says when the forum is +18", async () => {
  const { messages } = await import("@/i18n/messages");
  const f = messages.forum.threadFields;
  const mark = (marked: boolean, byForum: boolean) =>
    renderToStaticMarkup(
      withIntl(
        <ThreadFields
          prefixes={[]}
          title="A title"
          adult={{ marked, byForum }}
        />,
      ),
    );
  const own = mark(true, false);
  expect(own).toContain(f.adultLabel);
  expect(own).toContain(f.adultHelp);
  expect(own).toMatch(/<input[^>]*name="adultWas"[^>]*value="true"/);
  expect(mark(false, true)).toMatch(
    /<input[^>]*name="adultWas"[^>]*value="false"/,
  );
  expect(mark(false, true)).toContain(f.adultByForum);
  expect(draw(false, "")).not.toContain('name="isAdult"');
});
