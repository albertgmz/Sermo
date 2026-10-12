import type { User } from "@/lib/types";

// While this marker is in the page the stylesheet recolours the whole
// document, popups included: see the accent presets in globals.css.
export function SiteAccent({
  user,
}: {
  user: Pick<User, "appearance"> | null;
}) {
  const accent = user?.appearance.accent;
  return accent ? <span hidden data-site-accent={accent} /> : null;
}
