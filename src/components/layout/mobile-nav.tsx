"use client";

import {
  Bell,
  House,
  Inbox,
  LogIn,
  type LucideIcon,
  MessagesSquare,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { isActivePath } from "@/components/layout/nav";
import type { UnreadCounts } from "@/lib/db";
import type { User } from "@/lib/types";

type Item = {
  label: string;
  href: string;
  icon: LucideIcon;
  match?: string[];
  unread?: number;
};

export function MobileNav({
  user,
  unread,
}: {
  user: Pick<User, "username"> | null;
  unread: UnreadCounts;
}) {
  const pathname = usePathname();
  const items: Item[] = [
    { label: "Home", href: "/", icon: House },
    {
      label: "Forums",
      href: "/forums",
      icon: MessagesSquare,
      match: ["/threads"],
    },
    ...(user
      ? [
          {
            label: "Messages",
            href: "/conversations",
            icon: Inbox,
            unread: unread.conversations,
          },
          {
            label: "Alerts",
            href: "/notifications",
            icon: Bell,
            unread: unread.notifications,
          },
          {
            label: "Profile",
            href: `/members/${user.username}`,
            icon: UserRound,
            match: ["/account"],
          },
        ]
      : [{ label: "Log in", href: "/login", icon: LogIn }]),
  ];

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/80 pb-[env(safe-area-inset-bottom)] backdrop-blur-lg md:hidden"
    >
      <ul className="mx-auto grid h-14 max-w-lg auto-cols-fr grid-flow-col">
        {items.map(({ label, href, icon: Icon, match, unread: count }) => (
          <li key={label}>
            <Link
              href={href}
              aria-current={
                isActivePath(pathname, href, match) ? "page" : undefined
              }
              className="flex h-full flex-col items-center justify-center gap-1 text-[0.6875rem] font-medium text-muted-foreground transition-colors aria-[current=page]:text-primary"
            >
              <span className="relative">
                <Icon className="size-5" />
                {!!count && (
                  <span className="absolute -top-0.5 -right-1 size-2 rounded-full bg-primary ring-2 ring-background" />
                )}
              </span>
              {label}
              {!!count && <span className="sr-only">, {count} unread</span>}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
