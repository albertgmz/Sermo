import type { ReactNode } from "react";
import { iconComponent } from "@/components/icons/icon-set";
import type { MemberView } from "@/lib/sermo/views";
import { cn } from "@/lib/utils";

export type IconedUser = Pick<MemberView, "username" | "nameIcon">;

// The icon a member wears beside their name: decorative, sized to the text and in the colour of
// the name. A key the icon set does not know draws nothing. This file imports the whole icon set,
// so it belongs to server components only: a client component gets the drawn element instead.
function NameIcon({
  nameIcon,
  side,
}: {
  nameIcon: MemberView["nameIcon"];
  side: "before" | "after";
}) {
  if (!nameIcon || nameIcon.position !== side) return null;
  const Icon = iconComponent(nameIcon.icon);
  if (!Icon) return null;
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex size-[1.1em] shrink-0 align-[-0.15em] [&>svg]:size-full",
        side === "before" ? "me-[0.3em]" : "ms-[0.3em]",
      )}
    >
      <Icon aria-hidden="true" />
    </span>
  );
}

// A member's name with their icon on the side they chose. `children` replaces the plain name.
export function NameWithIcon({
  user,
  children,
}: {
  user: IconedUser;
  children?: ReactNode;
}) {
  return (
    <>
      <NameIcon nameIcon={user.nameIcon} side="before" />
      {children ?? user.username}
      <NameIcon nameIcon={user.nameIcon} side="after" />
    </>
  );
}
