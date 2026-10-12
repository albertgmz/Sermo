import { MemberCardTrigger } from "@/components/forum/member-card-trigger";
import { userLinkClass, userNameProps } from "@/components/forum/user-name";
import type { MemberView } from "@/lib/sermo/views";
import { cn } from "@/lib/utils";

export type LinkUser = Pick<MemberView, "id" | "username" | "nameColor">;

export function UserLink({
  user,
  className,
  children,
}: {
  user: LinkUser;
  className?: string;
  children?: React.ReactNode;
}) {
  const name = userNameProps(user);
  return (
    <MemberCardTrigger
      id={user.id}
      href={`/members/${user.id}`}
      name={user.username}
      className={cn(userLinkClass, name.className, className)}
      style={name.style}
    >
      {children ?? user.username}
    </MemberCardTrigger>
  );
}
