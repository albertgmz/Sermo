import "@/components/forum/member-card-parts";
import { LitePlaceholder } from "@/components/forum/lite-placeholder";
import { MemberCardTrigger } from "@/components/forum/member-card-trigger";
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
  // 24 px on a phone, 40 px from `md` up: one avatar for a row that draws it in its header line
  // on a phone and in a column beside the text above (`MessageRow`).
  "sm-lg": {
    box: "size-6 md:size-10",
    text: "text-(length:--text-tiny) md:text-sm",
    framed: true,
  },
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
  eager = false,
  className,
}: {
  user: AvatarUser;
  size?: UserAvatarSize;
  link?: boolean;
  // A picture in the first screen (the account menu, the profile hero, the account heading):
  // fetched at once, where every other avatar waits until it is near the viewport.
  eager?: boolean;
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
  const loading = eager
    ? ({ loading: "eager", decoding: "auto" } as const)
    : undefined;
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
            compact={
              size === "xs" || size === "sm"
                ? true
                : size === "sm-lg"
                  ? "below-md"
                  : false
            }
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
          {...loading}
          style={inner}
        />
      ) : (
        // The initials are drawn from an attribute, not as text: a link around them would otherwise
        // have a name like "GO" (a search engine audit rejects that as non-descriptive), where its
        // label already says whose avatar it is.
        <AvatarFallback
          data-initials={user.username.slice(0, 2)}
          className={cn(
            "font-semibold uppercase after:content-[attr(data-initials)]",
            text,
          )}
          style={inner}
        />
      )}
      {frame && placement && (
        <AvatarImage
          src={frame.url}
          alt=""
          {...loading}
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
  if (!linked || user.id === undefined) return avatar;
  return (
    <MemberCardTrigger
      avatar
      id={user.id}
      href={`/members/${user.id}`}
      name={user.username}
      aria-label={user.username}
      className={cn("shrink-0 rounded-full", className, unringed)}
    >
      {avatar}
    </MemberCardTrigger>
  );
}
