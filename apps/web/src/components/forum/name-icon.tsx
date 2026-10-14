import "server-only";

import type { ReactNode } from "react";
import { iconComponent } from "@/components/icons/icon-set";
import type { MemberView } from "@/lib/sermo/views";
import { cn } from "@/lib/utils";

export type IconedUser = Pick<MemberView, "username" | "nameIcon">;

// How the name sits beside its icon: breaking into lines, truncating, or truncating on a phone and
// breaking into lines from `md` up.
const NAME_LAYOUT = {
  wrap: "min-w-0 whitespace-normal [overflow-wrap:anywhere]",
  truncate: "min-w-0 truncate",
  responsive:
    "min-w-0 truncate md:overflow-visible md:text-clip md:whitespace-normal md:[overflow-wrap:anywhere]",
};

// The icon a member wears beside their name: decorative, sized to the text and in the colour of
// the name. A key the icon set does not know draws nothing. This file imports the whole icon set,
// so it belongs to server components only (`server-only` makes a client import a build error): a
// client component gets the drawn element instead.
export function NameWithIcon({
  user,
  wrap,
  children,
}: {
  user: IconedUser;
  // For a heading: the name breaks into lines instead of truncating, the icon stays beside it.
  // `"md"`: truncating below `md`, breaking into lines from `md` up. Left out, a name without an
  // icon is the plain text; given, the name is always its own span.
  wrap?: boolean | "md";
  children?: ReactNode;
}) {
  const name = children ?? user.username;
  const wears = user.nameIcon;
  const Icon = wears ? iconComponent(wears.icon) : null;
  // No icon: the plain name, laid out exactly as it was.
  if ((!wears || !Icon) && wrap === undefined) return <>{name}</>;
  // With an icon the name is its own truncating span beside an icon that never shrinks, so a
  // caller that truncates the name shortens the name and keeps the icon, on either side.
  const box = wears && Icon && (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex size-[1.1em] shrink-0 [&>svg]:size-full",
        wears.position === "before" ? "me-[0.3em]" : "ms-[0.3em]",
      )}
    >
      <Icon aria-hidden="true" />
    </span>
  );
  const layout =
    wrap === "md"
      ? NAME_LAYOUT.responsive
      : wrap
        ? NAME_LAYOUT.wrap
        : NAME_LAYOUT.truncate;
  return (
    <span className="inline-flex max-w-full items-center align-bottom">
      {wears?.position === "before" && box}
      <span className={layout}>{name}</span>
      {wears?.position === "after" && box}
    </span>
  );
}
