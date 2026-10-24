// XenForo's editor box (fcuba's style), drawn alike by the editor and by the plain box that stands
// in for it until it loads, so nothing moves when one takes the other's place. The colours are
// Sermo's tokens in the roles XenForo gives its own: the box is the muted fill and turns the card's
// while it is written in; its border keeps its colour (the formatting bar shows the focus too).
export const EDITOR_BOX =
  "min-w-0 rounded-[9px] border bg-card transition-colors";

// The text: 16 px / 22.4 px on a phone (iOS zooms into anything smaller) and XenForo's 15 px / 21 px
// from a tablet up, with its padding of 10 px 20 px 20 px. A one-line composer keeps a tighter box.
export const EDITOR_TEXT =
  "text-base leading-[1.4] md:text-[15px] md:leading-[21px]";
export const editorPadding = (compact: boolean) =>
  compact ? "px-3 py-2" : "pt-2.5 px-5 pb-5";

// The least height of the text, XenForo's 100 px, and one line in a one-line composer.
export const editorMinHeight = (compact: boolean) => (compact ? 40 : 100);
