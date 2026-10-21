import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  entryOf,
  fromKeyboard,
  imageTag,
  moveTo,
  placeStop,
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

// A button as the bar holds it: in the Tab order or not, in view or not.
const button = (id: string, shown = true) => ({ id, shown, tabIndex: -1 });
const inView = (control: { shown: boolean }) => control.shown;
const stops = (controls: { id: string; tabIndex: number }[]) =>
  controls.filter((control) => control.tabIndex === 0).map((c) => c.id);

test("exactly one button in view is in the Tab order, so Tab enters the bar and Shift+Tab leaves it", () => {
  const hidden = button("removeFormatting", false);
  const bold = button("bold");
  const italic = button("italic");
  const undo = button("undo");
  const controls = [hidden, bold, italic, undo];
  // Entry: the first in view, never the hidden one before it.
  expect(placeStop(controls, null, inView)).toBe(bold);
  expect(stops(controls)).toEqual(["bold"]);
  // The button used last (arrowed to) becomes the stop, and the one before leaves the Tab order,
  // so Shift+Tab from it goes to what is before the bar, not to another button of it.
  expect(placeStop(controls, undo, inView)).toBe(undo);
  expect(stops(controls)).toEqual(["undo"]);
});

test("when the button that was the stop goes out of view, the first in view takes its place", () => {
  const remove = button("removeFormatting");
  const bold = button("bold");
  const controls = [remove, bold];
  placeStop(controls, remove, inView);
  expect(stops(controls)).toEqual(["removeFormatting"]);
  // The bar narrowed (or its strip closed) while it had the focus: the bar keeps a stop.
  remove.shown = false;
  placeStop(controls, remove, inView);
  expect(stops(controls)).toEqual(["bold"]);
  // A bar out of view (a closed dialog) has none, and gets one back when it shows.
  bold.shown = false;
  expect(placeStop(controls, remove, inView)).toBeUndefined();
  expect(stops(controls)).toEqual([]);
  bold.shown = true;
  placeStop(controls, remove, inView);
  expect(stops(controls)).toEqual(["bold"]);
});

test("the stop is placed again after every redraw and every change of the bar's size", () => {
  const source = readFileSync(
    join(import.meta.dir, "editor-toolbar.tsx"),
    "utf8",
  );
  expect(source).toMatch(
    /useLayoutEffect\(\(\) => \{\s*placeTabStop\(\);\s*\}\);/,
  );
  expect(source).toContain("new ResizeObserver(placeTabStop)");
  // No state of "the focus is inside" that a vanished button could leave behind.
  expect(source).not.toMatch(/tabIndex=\{inside|setInside/);
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
