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
