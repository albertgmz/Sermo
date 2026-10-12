import type { User } from "@/lib/types";

// While this marker is in the page the stylesheet recolours the whole
// document, popups included: see the accent presets in globals.css. Only the
// sign-in pages still use it, with the account of the demo data.
export function SiteAccent({
  user,
}: {
  user: Pick<User, "appearance"> | null;
}) {
  const accent = user?.appearance.accent;
  return accent ? <span hidden data-site-accent={accent} /> : null;
}

export type AccentColors = { color: string; foreground: string | null };

const HEX = /^#[0-9a-f]{6}$/i;

// The accent is data: the two custom properties the stylesheet derives every accent colour from,
// set on the root so that popups, which sit outside the page, are recoloured too. A colour that is
// not #rrggbb is left out, since this text goes into a stylesheet.
export function accentCss(accent: AccentColors | null): string | null {
  if (!accent || !HEX.test(accent.color)) return null;
  const foreground =
    accent.foreground && HEX.test(accent.foreground)
      ? `--primary-foreground:${accent.foreground};`
      : "";
  return `:root{--primary:${accent.color};${foreground}}`;
}

// The accent the site shows the visitor: the one the member chose, else the palette's first.
export function ViewerAccent({ accent }: { accent: AccentColors | null }) {
  const css = accentCss(accent);
  return css ? <style>{css}</style> : null;
}
