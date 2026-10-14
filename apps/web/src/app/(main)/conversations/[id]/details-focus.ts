// A write in the details of a conversation ends in a redirect to the page, and the page's client
// parts are drawn anew: the drawer that held the form is gone and so is the focus that was in it.
// The form says a success may be coming; the button that opens the drawer, drawn again, takes the
// focus back (a drawer that closes in order returns it there itself).

// How long a mark stays valid: a redirect that never came must not give the focus away later.
export const MARK_MS = 5000;

let markedAt: number | null = null;

export function expectDetailsFocus(now = Date.now()) {
  markedAt = now;
}

export function forgetDetailsFocus() {
  markedAt = null;
}

// Whether the button should take the focus; asking clears the mark.
export function takeDetailsFocus(now = Date.now()) {
  const marked = markedAt !== null && now - markedAt <= MARK_MS;
  markedAt = null;
  return marked;
}
