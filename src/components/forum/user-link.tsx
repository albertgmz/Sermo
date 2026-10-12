import Link from "next/link";
import { nameColor } from "@/lib/appearance";
import type { Appearance, User } from "@/lib/types";
import { cn } from "@/lib/utils";

export type LinkUser = Pick<User, "id" | "username" | "role"> & {
  appearance?: Pick<Appearance, "nameColor">;
};

// A name colour the member picked wins over the staff colours.
export function userNameClass(user: Omit<LinkUser, "id" | "username">) {
  const picked = nameColor(user.appearance?.nameColor);
  if (picked) return picked.text;
  if (user.role === "admin") return "text-primary";
  if (user.role === "moderator") return "text-success";
}

export const userLinkClass = "font-semibold underline-offset-4 hover:underline";

export function UserLink({
  user,
  className,
}: {
  user: LinkUser;
  className?: string;
}) {
  return (
    <Link
      href={`/members/${user.id}`}
      className={cn(userLinkClass, userNameClass(user), className)}
    >
      {user.username}
    </Link>
  );
}
