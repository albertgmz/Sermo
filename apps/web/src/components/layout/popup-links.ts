// Whether a click inside a popup was on a link (or on whatever else `selector` names), which closes
// it. Not judged by `defaultPrevented`: Next's `Link` cancels the default of every click it
// follows itself, so a popup judging by it stayed over the page it had just opened.
export function closesPopup(target: EventTarget | null, selector = "a") {
  return (target as Element | null)?.closest?.(selector) != null;
}
