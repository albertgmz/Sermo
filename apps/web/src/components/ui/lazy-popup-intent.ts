// When a gesture on a not-yet-loaded trigger asks for the popup to open, and when it only asks for
// its code to be fetched. Plain functions, so the rules can be tested without a browser.

// How the popup opens: a click (Enter and Space on a button are clicks); for a menu, the arrow keys
// as well; for a link, Space too (a link is not clicked by it); a tooltip opens on a mouse or pen
// pointer over the trigger and on keyboard focus.
export type Opening = "click" | "menu" | "link" | "hover";

type PointerLike = { pointerType?: string };

// A pointer that can hover. Touch has no hover: a tooltip never opens for it, and the code is
// fetched by the touch itself.
export const hovers = (event: PointerLike) => event.pointerType !== "touch";

// The key that opens a menu from its button, as the button's own handler does once loaded.
export const opensFromKey = (opening: Opening, key: string) =>
  opening === "menu" && (key === "ArrowDown" || key === "ArrowUp");

// Space on a link. Its key down only keeps the page from scrolling; it opens on key up, as a button
// is clicked.
export const spaceOpens = (opening: Opening, key: string) =>
  opening === "link" && key === " ";

// A click that opens the popup: the primary button with no modifier. A modified click (new tab,
// download) and a middle or right click keep the browser's own behaviour, for a trigger that is
// also a link.
export function isPlainClick(event: {
  button: number;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}) {
  return (
    event.button === 0 &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.shiftKey &&
    !event.altKey
  );
}

// How long the pointer rests on a tooltip's trigger before the tooltip is swapped in and shown: the
// delay Base UI's own tooltip trigger has.
export const HOVER_DELAY = 600;

// What began the gesture that opened the popup. Base UI chooses where focus goes from how a popup
// was opened (a sheet opened by touch takes focus itself, so no keyboard rises; a menu opened by a
// key focuses its first item), and a popup that mounts already open has to be told.
export type OpenedBy = "touch" | "pointer" | "keyboard";

// A click with no pointer press before it is the keyboard's (Enter, Space, a shortcut's `.click()`).
export function openedByClick(pointerType: string | undefined): OpenedBy {
  if (pointerType === "touch") return "touch";
  return pointerType ? "pointer" : "keyboard";
}
