import Link from "next/link";
import { MemberCard } from "@/components/forum/member-card";
import { userLinkClass, userNameClass } from "@/components/forum/user-link";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import type { UserView } from "@/lib/db";
import { cn } from "@/lib/utils";

// A link to the member that previews their card on hover or keyboard focus.
// Touch devices get the plain link.
export function UserHoverCard({
  user,
  className,
  children,
}: {
  user: UserView;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <HoverCard>
      <HoverCardTrigger
        render={
          <Link
            href={`/members/${user.username}`}
            className={cn(userLinkClass, userNameClass(user), className)}
          />
        }
      >
        {children ?? user.username}
      </HoverCardTrigger>
      <HoverCardContent align="start" className="w-72 p-0">
        <MemberCard user={user} className="border-0 bg-transparent" />
      </HoverCardContent>
    </HoverCard>
  );
}
