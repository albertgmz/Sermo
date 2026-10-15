// When a gesture on a not-yet-loaded trigger asks for the popup to open, and when it only asks for
// its code to be fetched. Plain functions, so the rules can be tested without a browser.

// How the popup opens: a click (Enter and Space on a button are clicks), or, for a menu, the arrow
// keys as well; a tooltip opens on a mouse or pen pointer over the trigger and on keyboard focus.
export type Opening = "click" | "menu" | "hover";

type PointerLike = { pointerType?: string };

// A pointer that can hover. Touch has no hover: a tooltip never opens for it, and the code is
// fetched by the touch itself.
export const hovers = (event: PointerLike) => event.pointerType !== "touch";

// The key that opens a menu from its button, as the button's own handler does once loaded.
export const opensFromKey = (opening: Opening, key: string) =>
  opening === "menu" && (key === "ArrowDown" || key === "ArrowUp");

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
