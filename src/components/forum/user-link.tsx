import { MemberCardTrigger } from "@/components/forum/member-card-trigger";
import { userLinkClass, userNameClass } from "@/components/forum/user-name";
import type { Appearance, User } from "@/lib/types";
import { cn } from "@/lib/utils";

export type LinkUser = Pick<User, "id" | "username" | "role"> & {
  appearance?: Pick<Appearance, "nameColor">;
};

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
      id={user.id}
      href={`/members/${user.id}`}
      name={user.username}
      className={cn(userLinkClass, userNameClass(user), className)}
    >
      {children ?? user.username}
    </MemberCardTrigger>
  );
}
