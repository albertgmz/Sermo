import Link from "next/link";
import { LitePlaceholder } from "@/components/forum/lite-placeholder";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { liteAvatarLayout } from "@/lib/lite-avatar";
import { getLiteState } from "@/lib/lite-mode";
import type { MemberView } from "@/lib/sermo/views";
import { cn } from "@/lib/utils";

const SIZES = {
  xs: { box: "size-5", text: "text-[0.5rem]", framed: false },
  sm: { box: "size-6", text: "text-(length:--text-tiny)", framed: true },
  md: { box: "size-8", text: "text-xs", framed: true },
  lg: { box: "size-10", text: "text-sm", framed: true },
  xl: { box: "size-16", text: "text-xl", framed: true },
  "2xl": { box: "size-24", text: "text-3xl", framed: true },
};

export type UserAvatarSize = keyof typeof SIZES;

export type AvatarUser = Pick<MemberView, "username" | "avatar" | "frame"> & {
  id?: number;
};

export async function UserAvatar({
  user,
  size = "md",
  link = true,
  className,
}: {
  user: AvatarUser;
  size?: UserAvatarSize;
  link?: boolean;
  className?: string;
}) {
  const linked = link && user.id !== undefined;
  const { box, text, framed } = SIZES[size];
  const { hideAvatar, frame, placement } = liteAvatarLayout(
    await getLiteState(),
    (framed && user.frame) || null,
  );
  // The frame is drawn larger than the box and the picture shrinks into its
  // opening, so a framed avatar takes the same room as a plain one.
  const inner = placement ? { scale: placement.scale / 100 } : undefined;
  const unringed = placement && "ring-0!";
  const avatar = (
    <Avatar
      className={cn(
        box,
        placement && "after:hidden",
        !linked && [className, unringed],
      )}
    >
      {hideAvatar ? (
        <span className="size-full" style={inner}>
          <LitePlaceholder
            compact={size === "xs" || size === "sm"}
            className="size-full rounded-full"
          />
        </span>
      ) : user.avatar ? (
        <AvatarImage
          src={
            size === "xl" || size === "2xl"
              ? user.avatar.url
              : user.avatar.smallUrl
          }
          alt=""
          style={inner}
        />
      ) : (
        <AvatarFallback
          className={cn("font-semibold uppercase", text)}
          style={inner}
        >
          {user.username.slice(0, 2)}
        </AvatarFallback>
      )}
      {frame && placement && (
        <AvatarImage
          src={frame.url}
          alt=""
          className="pointer-events-none absolute aspect-auto size-auto max-w-none rounded-none object-fill"
          style={{
            width: `${placement.width}%`,
            left: `${placement.left}%`,
            top: `${placement.top}%`,
          }}
        />
      )}
    </Avatar>
  );
  if (!linked) return avatar;
  return (
    <Link
      href={`/members/${user.id}`}
      aria-label={user.username}
      className={cn("shrink-0 rounded-full", className, unringed)}
    >
      {avatar}
    </Link>
  );
}
