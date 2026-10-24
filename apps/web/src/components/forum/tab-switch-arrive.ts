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

export function arriveAt(
  node: HTMLDivElement,
  href: string | null,
  part: string | null,
  titled: { title: string; part: string } | null,
) {
  if (part && titled) document.title = titled.title.replace(titled.part, part);
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
