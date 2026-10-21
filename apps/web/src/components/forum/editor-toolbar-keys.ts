// How the formatting bar answers the keyboard and its Image button, kept out of the component so
// that it can be tested without a browser. The bar is one stop of the Tab order (WAI-ARIA's toolbar
// pattern): Tab lands on the button last used there, or on the first one the bar's size shows, and
// the arrow keys, Home and End move between the buttons in view. A button hidden by the bar's size
// is never the stop, whatever the bar's width became since it was last used: the stop is placed
// again after every redraw and every change of the bar's size.

import { isWebAddress, linkAddressOf } from "@/components/forum/bb-scan";
import type { GroupId } from "@/components/forum/editor-toolbar-layout";

// Where the arrow keys, Home and End go from control `at` of `count` in view (the ends wrap round),
// or null for any other key.
export function moveTo(key: string, at: number, count: number): number | null {
  if (count === 0) return null;
  switch (key) {
    case "ArrowRight":
      return at < 0 ? 0 : (at + 1) % count;
    case "ArrowLeft":
      return at < 0 ? count - 1 : (at - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}

// The control a Tab into the bar lands on: the one last used, while it is in view, else the first
// in view.
export function entryOf<T>(
  controls: readonly T[],
  last: T | null,
  shown: (control: T) => boolean,
): T | undefined {
  if (last !== null && controls.includes(last) && shown(last)) return last;
  return controls.find(shown);
}

// Makes one control of the bar the stop of the Tab order (`tabIndex` 0) and every other one -1: the
// one last used while it is in view, else the first in view, else none (a bar out of view). Tab
// from before the bar lands on it, Shift+Tab from it leaves the bar, as nothing else of it is in
// the Tab order.
export function placeStop<T extends { tabIndex: number }>(
  controls: readonly T[],
  last: T | null,
  shown: (control: T) => boolean,
): T | undefined {
  const stop = entryOf(controls, last, shown);
  for (const control of controls) {
    const index = control === stop ? 0 : -1;
    if (control.tabIndex !== index) control.tabIndex = index;
  }
  return stop;
}

// Whether a press came from the keyboard (Enter or Space on a button is a click with no pointer
// behind it), which then goes on into the strip it opened.
export const fromKeyboard = (event: { detail: number }) => event.detail === 0;

// Escape while a strip is open closes the strip and nothing else: the dialog the composer may be
// in listens for Escape on the document, so the key stops at the bar. Run as the bar's own native
// listener, which comes before any listener on the document. The answer is the strip to close.
export function stripEscape(
  event: Pick<KeyboardEvent, "key" | "stopPropagation" | "preventDefault">,
  open: GroupId | null,
): GroupId | null {
  if (event.key !== "Escape" || open === null) return null;
  event.stopPropagation();
  event.preventDefault();
  return open;
}

// Listens on the bar for an Escape that closes its open strip (`open` reads which, `close` closes
// it and gives the focus back to its "⋮").
export function registerStripEscape(
  bar: EventTarget,
  open: () => GroupId | null,
  close: (group: GroupId) => void,
) {
  const listener = (event: Event) => {
    const group = stripEscape(event as KeyboardEvent, open());
    if (group) close(group);
  };
  bar.addEventListener("keydown", listener);
  return () => bar.removeEventListener("keydown", listener);
}

// What the Image button puts in the text for an address the member typed, where the composer has
// no picture picker: a picture on the web, or `refused` for anything else, or nothing when the
// question was left empty.
export function imageTag(input: string | null): string | "refused" | null {
  if (!input) return null;
  const url = linkAddressOf(input);
  return url !== null && isWebAddress(url) ? `[IMG]${url}[/IMG]` : "refused";
}
