import {
  MemberCard,
  type MemberCardUser,
} from "@/components/forum/member-card";
import { MemberCardTrigger } from "@/components/forum/member-card-trigger";
import { userLinkClass, userNameClass } from "@/components/forum/user-name";
import { cn } from "@/lib/utils";

export type LinkUser = MemberCardUser;
export { userLinkClass, userNameClass } from "@/components/forum/user-name";

export function UserLink({
  user,
  className,
  children,
}: {
  user: LinkUser;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <MemberCardTrigger
      href={`/members/${user.id}`}
      name={user.username}
      className={cn(userLinkClass, userNameClass(user), className)}
      card={<MemberCard user={user} className="border-0 bg-transparent" />}
    >
      {children ?? user.username}
    </MemberCardTrigger>
  );
}
