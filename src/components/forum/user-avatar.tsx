import Link from "next/link";
import { LitePlaceholder } from "@/components/forum/lite-placeholder";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { FRAMES, frameSrc } from "@/lib/frames";
import { liteBlocks } from "@/lib/lite-mode";
import type { Appearance, User } from "@/lib/types";
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

export type AvatarUser = Pick<User, "username" | "avatar"> & {
  id?: number;
  appearance?: Pick<Appearance, "frame">;
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
  const [hideAvatar, hideFrame] = await Promise.all([
    liteBlocks("avatars"),
    liteBlocks("frames"),
  ]);
  const linked = link && user.id !== undefined;
  const { box, text, framed } = SIZES[size];
  const frame = (!hideFrame && framed && user.appearance?.frame) || null;
  const geometry = frame ? FRAMES[frame] : undefined;
  // The frame is drawn larger than the box and the picture shrinks into its
  // opening, so a framed avatar takes the same room as a plain one.
  const inner = geometry ? { scale: geometry[3] / 100 } : undefined;
  const unringed = geometry && "ring-0!";
  const avatar = (
    <Avatar
      className={cn(
        box,
        geometry && "after:hidden",
        !linked && [className, unringed],
      )}
    >
      {hideAvatar ? (
        <LitePlaceholder
          compact={size === "xs" || size === "sm"}
          className="size-full rounded-full"
        />
      ) : user.avatar ? (
        <AvatarImage src={user.avatar} alt="" style={inner} />
      ) : (
        <AvatarFallback
          className={cn("font-semibold uppercase", text)}
          style={inner}
        >
          {user.username.slice(0, 2)}
        </AvatarFallback>
      )}
      {frame && geometry && (
        <AvatarImage
          src={frameSrc(frame)}
          alt=""
          className="pointer-events-none absolute aspect-auto size-auto max-w-none rounded-none object-fill"
          style={{
            width: `${geometry[0]}%`,
            left: `${geometry[1]}%`,
            top: `${geometry[2]}%`,
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
