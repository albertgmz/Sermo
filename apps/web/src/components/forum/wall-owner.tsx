import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { UserLink } from "@/components/forum/user-link";
import type { MemberView } from "@/lib/sermo/views";
import { cn } from "@/lib/utils";

// Where a wall post stands for the feed: on its author's own wall, on another member's wall whose
// owner is known by name, or on a wall whose owner the lookup could not name (a member who is
// gone), which the item words as "posted on a profile".
export function wallPlace(
  authorId: number | null,
  ownerId: number,
  member: (id: number) => MemberView,
): { kind: "own" | "unnamed" } | { kind: "other"; owner: MemberView } {
  if (ownerId === authorId) return { kind: "own" };
  const owner = member(ownerId);
  return owner.username === "" ? { kind: "unnamed" } : { kind: "other", owner };
}

// `▸ Owner`, drawn after the author's name as XenForo does: a muted caret for the eye, and for a
// screen reader the words that link the author's name to the owner's. `className` styles the
// owner's link only: the caret is decoration, and a press on it may fall through to the item.
export function WallOwner({
  owner,
  className,
}: {
  owner: MemberView;
  className?: string;
}) {
  const t = useTranslations("forum.wallOwner");
  return (
    <>
      <span className="sr-only">{t("wroteOn")}</span>
      <ChevronRight
        aria-hidden="true"
        className="inline size-3.5 shrink-0 align-[-0.15em] text-muted-foreground rtl:rotate-180"
      />{" "}
      <UserLink user={owner} className={className} />
    </>
  );
}

// The look of a link inside the muted line that says where an item was made.
export const contextLinkClass =
  "font-medium text-foreground underline-offset-4 hover:underline";

// "posted on a profile", linked to the wall: for a wall whose owner has no name.
export function UnnamedWall({
  ownerId,
  className,
}: {
  ownerId: number;
  className?: string;
}) {
  const t = useTranslations("home.feedItem");
  return t.rich("profileContext", {
    profile: (chunks) => (
      <Link
        href={`/members/${ownerId}`}
        className={cn(contextLinkClass, className)}
      >
        {chunks}
      </Link>
    ),
  });
}
