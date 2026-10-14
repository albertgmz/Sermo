// When a click on a member's avatar, name or mention opens the card, and what happens around it.
// Plain functions, so the rules can be tested without a browser.

// The primary button with no modifier: the click that opens the card. A modified click (new tab,
// new window, download) and a middle or right click keep the browser's own behaviour. A trigger
// built on Base UI needs nothing else for the keyboard: Enter is a native click on the link and
// Space is turned into one (modifiers kept) on key up; handling Space again would open the card
// and close it at once.
export function opensCard(event: {
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

// Space on a plain link (a mention) does not click it; it opens the card as it would a button.
export const opensCardKey = (key: string) => key === " ";

// What a card shows when its member could not be read (no answer, or a failure): the card that is
// already there, else the fallback.
export function settledCard<T>(
  previous: T | undefined,
  next: T | null | undefined,
  fallback: T,
): T {
  return next ?? previous ?? fallback;
}

// Whether closing a card gives focus back to the mention it came from: after Escape, or when focus
// was inside the card (a click elsewhere puts it where the visitor chose), and only while the link
// is still on the page.
export function returnsFocusToLink(options: {
  reason: string | undefined;
  focusInside: boolean;
  connected: boolean;
}) {
  return (
    options.connected &&
    (options.reason === "escape-key" || options.focusInside)
  );
}

// A press on the anchor of an open card is not a dismissal: the click that follows closes it.
export function isPressOnAnchor(
  details: { reason: string; event: { target: EventTarget | null } },
  anchor: { contains(other: Node | null): boolean },
) {
  return (
    details.reason === "outside-press" &&
    details.event.target instanceof Node &&
    anchor.contains(details.event.target)
  );
}
