import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  entryOf,
  fromKeyboard,
  imageTag,
  moveTo,
  registerStripEscape,
} from "./editor-toolbar-keys";
import type { GroupId } from "./editor-toolbar-layout";

test("the arrow keys go to the next and the previous button in view, round the ends; Home and End to the ends", () => {
  expect(moveTo("ArrowRight", 0, 3)).toBe(1);
  expect(moveTo("ArrowRight", 2, 3)).toBe(0);
  expect(moveTo("ArrowLeft", 0, 3)).toBe(2);
  expect(moveTo("ArrowLeft", 2, 3)).toBe(1);
  expect(moveTo("Home", 2, 3)).toBe(0);
  expect(moveTo("End", 0, 3)).toBe(2);
  // From the bar itself (no button of it has the focus).
  expect(moveTo("ArrowRight", -1, 3)).toBe(0);
  expect(moveTo("ArrowLeft", -1, 3)).toBe(2);
  // Other keys are the button's own (Enter, Space) or the page's (Tab).
  for (const key of ["Enter", " ", "Tab", "ArrowDown", "a"]) {
    expect(moveTo(key, 1, 3)).toBeNull();
  }
  expect(moveTo("ArrowRight", -1, 0)).toBeNull();
});

test("Tab lands on the button last used while it is in view, and never on one the bar's size hides", () => {
  const shown = new Set(["bold", "italic", "undo"]);
  const inView = (id: string) => shown.has(id);
  const controls = ["removeFormatting", "bold", "italic", "undo"];
  expect(entryOf(controls, null, inView)).toBe("bold");
  expect(entryOf(controls, "undo", inView)).toBe("undo");
  // The last one used went out of view (the bar narrowed): the first in view takes it.
  expect(entryOf(controls, "removeFormatting", inView)).toBe("bold");
  // One that is no longer in the bar at all.
  expect(entryOf(controls, "gone", inView)).toBe("bold");
  expect(entryOf(controls, null, () => false)).toBeUndefined();
});

test("a ⋮ pressed from the keyboard takes the focus into its strip, one pressed by a pointer leaves it in the text", () => {
  expect(fromKeyboard({ detail: 0 })).toBe(true);
  expect(fromKeyboard({ detail: 1 })).toBe(false);
  expect(fromKeyboard({ detail: 2 })).toBe(false);
});

// A dialog as Base UI's is: it closes on an Escape that reaches the document. The bar is below
// the document, so its own listener runs first, and an event it stops goes no further.
function page() {
  const bar = new EventTarget();
  const document = new EventTarget();
  const closed: string[] = [];
  document.addEventListener("keydown", () => closed.push("dialog"));
  const press = (key: string) => {
    const event = new Event("keydown", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "key", { value: key });
    let stopped = false;
    const stop = event.stopPropagation.bind(event);
    event.stopPropagation = () => {
      stopped = true;
      stop();
    };
    bar.dispatchEvent(event);
    if (!stopped) document.dispatchEvent(event);
    return event;
  };
  return { bar, closed, press };
}

test("Escape in an open strip inside a dialog closes the strip only, and the focus goes back to its ⋮", () => {
  const { bar, closed, press } = page();
  let open: GroupId | null = "insert";
  const stop = registerStripEscape(
    bar,
    () => open,
    (group) => {
      closed.push(`strip ${group}`);
      open = null;
    },
  );
  const first = press("Escape");
  expect(closed).toEqual(["strip insert"]);
  expect(first.defaultPrevented).toBe(true);
  // With no strip open, Escape is the dialog's again.
  press("Escape");
  expect(closed).toEqual(["strip insert", "dialog"]);
  // Other keys pass, and a strip open again closes again.
  open = "text";
  press("Enter");
  expect(closed).toEqual(["strip insert", "dialog", "dialog"]);
  press("Escape");
  expect(closed).toEqual(["strip insert", "dialog", "dialog", "strip text"]);
  stop();
  open = "misc";
  press("Escape");
  expect(closed.at(-1)).toBe("dialog");
});

test("the bar takes Escape with a native listener of its own, not through React", () => {
  // React's own listener sits on the document beside the dialog's, where stopping it is too late.
  const source = readFileSync(
    join(import.meta.dir, "editor-toolbar.tsx"),
    "utf8",
  );
  expect(source).toContain("registerStripEscape(");
  expect(source).not.toMatch(/key === "Escape"|key !== "Escape"/);
});

test("the Image button's address question: a picture on the web, or refused, or nothing", () => {
  expect(imageTag("https://x.test/a.png")).toBe(
    "[IMG]https://x.test/a.png[/IMG]",
  );
  expect(imageTag("  http://x.test/a.png ")).toBe(
    "[IMG]http://x.test/a.png[/IMG]",
  );
  expect(imageTag("www.x.test/a.png")).toBe(
    "[IMG]https://www.x.test/a.png[/IMG]",
  );
  // A page of the site is a link, not a picture the renderer shows; the rest is no address.
  expect(imageTag("/attachments/5")).toBe("refused");
  expect(imageTag("javascript:alert(1)")).toBe("refused");
  expect(imageTag("x.test/a b.png")).toBe("refused");
  expect(imageTag("")).toBeNull();
  expect(imageTag(null)).toBeNull();
});

test("with a picture picker in its composer, the Image button opens it and asks nothing", () => {
  const toolbar = readFileSync(
    join(import.meta.dir, "editor-toolbar.tsx"),
    "utf8",
  );
  const addImage = toolbar.slice(toolbar.indexOf("function addImage()"));
  // The picker first; the question only where nothing took the request.
  expect(addImage.indexOf("pickImage(")).toBeLessThan(addImage.indexOf("ask("));
  expect(addImage.slice(0, addImage.indexOf("ask("))).toMatch(
    /if \(pickImage\(.*\)\) \{\s*setRefused\(null\);\s*return;/,
  );
  // The picker's pictures go through the list's intake as pictures that came into the text,
  // which puts each one at the caret, full size, once it is stored (attachment-intake.test.ts).
  const field = readFileSync(
    join(import.meta.dir, "attachment-field.tsx"),
    "utf8",
  );
  expect(field).toMatch(
    /ref=\{picker\}[\s\S]*?accept="image\/\*"[\s\S]*?onChange=\{choose\(true\)\}/,
  );
  expect(field).toContain(
    'place: (file) => latest.current.place(file, "full", true)',
  );
});
