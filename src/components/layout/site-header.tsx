import { Bell, Inbox, Search } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { LoadingRegion } from "@/components/forum/skeletons";
import { UserAvatar } from "@/components/forum/user-avatar";
import { Container } from "@/components/layout/container";
import {
  AlertsPanel,
  headerIconClass,
  MessagesPanel,
  SearchPanel,
} from "@/components/layout/header-panels";
import { LiteModeToggle } from "@/components/layout/lite-mode-toggle";
import { Logo } from "@/components/layout/logo";
import { HeaderNav, MobileMenu } from "@/components/layout/site-nav";
import { UserMenu } from "@/components/layout/user-menu";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getConversations, getNotifications, getUnreadCounts } from "@/lib/db";
import { isLiteMode } from "@/lib/lite-mode";
import { getCurrentUser } from "@/lib/session";
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

export function SiteHeader() {
  return (
    <header className="border-b bg-background">
      <Container className="flex h-14 items-center gap-1 md:gap-4">
        <Suspense
          fallback={
            <div className="-ml-2 md:hidden">
              <LoadingRegion label="Loading menu…">
                <Skeleton className="size-10" />
              </LoadingRegion>
            </div>
          }
        >
          <MobileMenu className="-ml-2 md:hidden" />
        </Suspense>
        <Logo markOnly className="w-10 justify-center md:hidden" />
        <Logo className="hidden md:inline-flex" />
        <Suspense
          fallback={
            <div className="hidden md:block">
              <LoadingRegion label="Loading navigation…">
                <div className="flex h-10 items-center gap-1">
                  {[1, 2, 3, 4, 5, 6].map((item) => (
                    <Skeleton key={item} className="h-10 w-16" />
                  ))}
                </div>
              </LoadingRegion>
            </div>
          }
        >
          <HeaderNav className="hidden md:flex" />
        </Suspense>
        <div className="ml-auto flex items-center gap-1 md:gap-2">
          <IconLink href="/search" label="Search">
            <Search />
          </IconLink>
          <SearchPanel className={PANEL} />
          <Suspense
            fallback={
              <LoadingRegion label="Loading your menu…">
                <Skeleton className="h-10 w-28 md:w-32" />
              </LoadingRegion>
            }
          >
            <AccountTools />
          </Suspense>
        </div>
      </Container>
      <Container className="flex justify-end pb-2">
        <Suspense fallback={<Skeleton className="h-10 w-32" />}>
          <LiteTools />
        </Suspense>
      </Container>
    </header>
  );
}

async function LiteTools() {
  return <LiteModeToggle enabled={await isLiteMode()} />;
}

async function AccountTools() {
  const user = await getCurrentUser();
  return (
    <>
      {user ? (
        <>
          <Suspense
            fallback={
              <LoadingRegion label="Loading messages…">
                <Skeleton className="size-10" />
              </LoadingRegion>
            }
          >
            <MessageTools userId={user.id} />
          </Suspense>
          <Suspense
            fallback={
              <LoadingRegion label="Loading alerts…">
                <Skeleton className="size-10" />
              </LoadingRegion>
            }
          >
            <AlertTools userId={user.id} />
          </Suspense>
          <UserMenu
            avatar={<UserAvatar user={user} size="md" link={false} />}
            user={{
              id: user.id,
              username: user.username,
              title: user.title,
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
    </>
  );
}

async function MessageTools({ userId }: { userId: number }) {
  const [conversations, unread] = await Promise.all([
    getConversations(userId),
    getUnreadCounts(userId),
  ]);
  return (
    <>
      <IconLink
        href="/conversations"
        label="Conversations"
        unread={unread.conversations}
      >
        <Inbox />
      </IconLink>
      <MessagesPanel
        user={{ id: userId }}
        conversations={conversations.slice(0, 5)}
        unread={unread.conversations}
        className={PANEL}
      />
    </>
  );
}

async function AlertTools({ userId }: { userId: number }) {
  const [notifications, unread] = await Promise.all([
    getNotifications(userId),
    getUnreadCounts(userId),
  ]);
  return (
    <>
      <IconLink
        href="/notifications"
        label="Notifications"
        unread={unread.notifications}
      >
        <Bell />
      </IconLink>
      <AlertsPanel
        notifications={notifications.slice(0, 6)}
        unread={unread.notifications}
        className={PANEL}
      />
    </>
  );
}
