// When a member card may open. Plain functions, so the rules can be tested without a browser.

// A tap (touch or pen) is a plain click on the link: the card never opens from it.
export const isTouchLike = (pointerType: string) =>
  pointerType === "touch" || pointerType === "pen";

// What a trigger does with a request from its popover to change state.
export function openChange(
  next: boolean,
  pointerType: string,
): "open" | "close" | "ignore" {
  if (!next) return "close";
  return isTouchLike(pointerType) ? "ignore" : "open";
}

// Whether keyboard focus on a trigger opens the card: only for a name, shown after keyboard
// navigation. An avatar sits beside the name, which opens it, so tabbing is not doubled.
export function opensOnFocus(options: {
  pointerType: string;
  avatar: boolean | undefined;
  focusVisible: boolean;
}) {
  return (
    !options.avatar && options.focusVisible && !isTouchLike(options.pointerType)
  );
}
