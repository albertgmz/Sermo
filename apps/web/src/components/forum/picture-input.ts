// How far a finger has to move sideways to turn the page.
export const SWIPE_PX = 50;

type Step = "next" | "previous" | null;

// The list runs newest first, so the next picture is an older one. Arrow keys step, unless a
// modifier is down or the key is meant for a field (the reply composer).
export function arrowStep(
  key: string,
  modified: boolean,
  inField: boolean,
): Step {
  if (modified || inField) return null;
  if (key === "ArrowRight") return "next";
  if (key === "ArrowLeft") return "previous";
  return null;
}

// A swipe left shows the next picture and a swipe right the one before, when it went far enough
// and more across than down (a scroll is not a swipe).
export function swipeStep(across: number, down: number): Step {
  if (Math.abs(across) < SWIPE_PX) return null;
  if (Math.abs(across) < Math.abs(down) * 1.5) return null;
  return across < 0 ? "next" : "previous";
}

// What closes the viewer. Only its own close button (or code) does. Esc closes it unless the key
// was meant for something drawn on top of it (a mention list that handled it, a reaction picker or
// the list of who reacted): that closes first and the viewer stays. A press or focus that lands in
// a popup drawn outside the viewer's markup (the picker, the list) is not a way out of it, so those
// reasons never close it; the viewer covers the whole screen, so nothing else can produce them.
export function closeAnswer(
  reason: string,
  handled: boolean,
  popupOpen: boolean,
): "close" | "keep" {
  if (reason === "outside-press" || reason === "focus-out") return "keep";
  if (reason === "escape-key" && (handled || popupOpen)) return "keep";
  return "close";
}
