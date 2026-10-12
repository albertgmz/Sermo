import { Bell, Inbox, Search } from "lucide-react";
import Link from "next/link";
import { Container } from "@/components/layout/container";
import {
  AlertsPanel,
  headerIconClass,
  MessagesPanel,
  SearchPanel,
} from "@/components/layout/header-panels";
import { Logo } from "@/components/layout/logo";
import { HeaderNav, MobileMenu } from "@/components/layout/site-nav";
import { UserMenu } from "@/components/layout/user-menu";
import { buttonVariants } from "@/components/ui/button";
import type {
  ConversationView,
  NotificationView,
  UnreadCounts,
  UserView,
} from "@/lib/db";
import { cn } from "@/lib/utils";

const PANEL = "hidden md:inline-flex";

function IconLink({
  href,
  label,
  unread = 0,
  children,
}: {
  href: string;
  label: string;
  unread?: number;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-label={unread ? `${label}, ${unread} unread` : label}
      className={cn(headerIconClass, "md:hidden")}
    >
      {children}
      {unread > 0 && (
        <span className="absolute top-2 right-2 size-2 rounded-full bg-primary ring-2 ring-background" />
      )}
    </Link>
  );
}

export function SiteHeader({
  user,
  unread,
  conversations,
  notifications,
}: {
  user: UserView | null;
  unread: UnreadCounts;
  conversations: ConversationView[];
  notifications: NotificationView[];
}) {
  return (
    <header className="border-b bg-background">
      <Container className="flex h-14 items-center gap-1 md:gap-4">
        <MobileMenu className="-ml-2 md:hidden" />
        <Logo markOnly className="w-10 justify-center md:hidden" />
        <Logo className="hidden md:inline-flex" />
        <HeaderNav className="hidden md:flex" />
        <div className="ml-auto flex items-center gap-1 md:gap-2">
          <IconLink href="/search" label="Search">
            <Search />
          </IconLink>
          <SearchPanel className={PANEL} />
          {user ? (
            <>
              <IconLink
                href="/conversations"
                label="Conversations"
                unread={unread.conversations}
              >
                <Inbox />
              </IconLink>
              <MessagesPanel
                user={user}
                conversations={conversations}
                unread={unread.conversations}
                className={PANEL}
              />
              <IconLink
                href="/notifications"
                label="Notifications"
                unread={unread.notifications}
              >
                <Bell />
              </IconLink>
              <AlertsPanel
                notifications={notifications}
                unread={unread.notifications}
                className={PANEL}
              />
              <UserMenu
                user={{
                  id: user.id,
                  username: user.username,
                  title: user.title,
                  avatar: user.avatar,
                  appearance: { frame: user.appearance.frame },
                }}
              />
            </>
          ) : (
            <>
              <Link
                href="/login"
                className={cn(
                  buttonVariants({ variant: "outline" }),
                  "h-10 px-3 md:h-8",
                )}
              >
                Log in
              </Link>
              <Link
                href="/register"
                className={cn(buttonVariants(), "h-10 px-3 md:h-8")}
              >
                Create Account
              </Link>
            </>
          )}
        </div>
      </Container>
    </header>
  );
}
