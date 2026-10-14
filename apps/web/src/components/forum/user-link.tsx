import "@/components/forum/member-card-parts";
import { MemberCardTrigger } from "@/components/forum/member-card-trigger";
import { NameWithIcon } from "@/components/forum/name-icon";
import { userLinkClass, userNameProps } from "@/components/forum/user-name";
import type { MemberView } from "@/lib/sermo/views";
import { cn } from "@/lib/utils";

export type LinkUser = Pick<
  MemberView,
  "id" | "username" | "nameColor" | "nameIcon"
>;

export function UserLink({
  user,
  className,
  wrap,
  children,
}: {
  user: LinkUser;
  className?: string;
  // How a long name is laid out: see NameWithIcon.
  wrap?: boolean | "md";
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
      <NameWithIcon user={user} wrap={wrap}>
        {children}
      </NameWithIcon>
    </MemberCardTrigger>
  );
}
