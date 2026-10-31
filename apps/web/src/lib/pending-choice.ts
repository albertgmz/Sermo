// A choice in a menu of links to the page it is on (a filter) is a navigation, and its menu closes
// at once. Until the address answers, the part it changes shows as pending. The rule is kept apart
// from the component so that it can be read and tested alone.

// What a part knows: the address it last saw (its query as `URLSearchParams` text) and, after a
// press, the address the press was made at.
export type Held = { at: string; pressedAt: string | null };

const queryOf = (search: string) => new URLSearchParams(search).toString();

export const holdAt = (search: string): Held => ({
  at: queryOf(search),
  pressedAt: null,
});

// The address a link's press is made at, when the link is a choice of a menu that opens this same
// page with another query; null for anything else (another page, a new tab, a pager, the choice
// already on screen). The page is the same when the path is: the menu's links are built from the
// path the request came in by.
export function pressAt(
  href: string,
  here: URL,
  { newTab, inMenu }: { newTab: boolean; inMenu: boolean },
): string | null {
  if (newTab || !inMenu) return null;
  const url = new URL(href, here);
  if (url.origin !== here.origin || url.pathname !== here.pathname) return null;
  const from = queryOf(here.search);
  return queryOf(url.search) === from ? null : from;
}

export const pressed = (held: Held, pressedAt: string | null): Held =>
  pressedAt === null ? held : { ...held, pressedAt };

// The part as the address `search` shows it: any change of the address ends the wait (the choice
// arrived, or the visitor went Back or Forward), and an old press must not come back when the
// address returns to where it was made.
export const settle = (held: Held, search: string): Held =>
  queryOf(search) === held.at ? held : holdAt(search);

export const busyOf = (held: Held) => held.pressedAt !== null;
