// What a `TabSwitch` does once a part has come in: the page's title follows it, the keyboard returns
// to the link pressed, and the screen goes to the anchor the address names or, when the top of the
// part is above the screen (a press further down), to the top of the part. Its own module: it is
// not needed until the first press.

// The element an address's anchor names, if the page holds it (a malformed one names none).
function anchorOf(hash: string) {
  if (!hash) return null;
  try {
    return document.getElementById(decodeURIComponent(hash.slice(1)));
  } catch {
    return null;
  }
}

// The page's title as the server drew it, and the name of the part in it.
export type Titled = { title: string; part: string };

// The name of the part shown, where it has one of its own (`data-switch-title`).
function titleOf(node: HTMLElement | null) {
  return (
    node
      ?.querySelector("[data-switch-title]")
      ?.getAttribute("data-switch-title") ?? null
  );
}

// Before the first part is brought in: the title and part name the server drew.
export function rememberTitle(
  node: HTMLElement | null,
  titled: { current: Titled | null },
) {
  const part = titleOf(node);
  if (part && !titled.current) titled.current = { title: document.title, part };
}

export function arriveAt(
  node: HTMLDivElement,
  href: string | null,
  titled: { current: Titled | null },
) {
  const part = titleOf(node);
  if (part && titled.current)
    document.title = titled.current.title.replace(titled.current.part, part);
  const active = document.activeElement;
  // The link drawn anew in its place: the one on screen, where a page draws a bar per screen size
  // (the feed's phone bar is hidden on a wider screen).
  if (href && (!active || active === document.body))
    [...node.querySelectorAll<HTMLElement>(`a[href="${CSS.escape(href)}"]`)]
      .find((link) => link.getClientRects().length > 0)
      ?.focus({ preventScroll: true });
  const target = anchorOf(location.hash);
  if (target) {
    target.scrollIntoView({ block: "start" });
    return;
  }
  const header = Number.parseFloat(
    getComputedStyle(document.documentElement).scrollPaddingTop,
  );
  if (node.getBoundingClientRect().top < (header || 0))
    node.scrollIntoView({ block: "start" });
}
