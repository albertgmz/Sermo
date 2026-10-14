// When a click on a member's avatar, name or mention opens the card. Plain functions, so the rule
// can be tested without a browser.

// The primary button with no modifier: the click that opens the card. A modified click (new tab,
// new window, download) and a middle or right click keep the browser's own behaviour.
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

// Space on a link does not click it; it opens the card as it would a button.
export const opensCardKey = (key: string) => key === " ";
