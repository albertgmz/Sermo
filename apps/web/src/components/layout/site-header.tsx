import { Bell, Inbox, Search } from "lucide-react";
import { io } from "next/cache";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
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
import { Logo } from "@/components/layout/logo";
import { HeaderNav, MobileMenu } from "@/components/layout/site-nav";
import { UserMenu } from "@/components/layout/user-menu";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getConversations, getNotifications, getUnreadCounts } from "@/lib/db";
import { titleKeyForLevel } from "@/lib/levels";
import { getLiteState } from "@/lib/lite-mode";
import { can } from "@/lib/permissions";
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
  const t = useTranslations("layout.siteHeader");
  return (
    <Link
      href={href}
      aria-label={unread ? t("aria.unread", { label, count: unread }) : label}
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
  const t = useTranslations("layout.siteHeader");
  return (
    <header className="border-b bg-background">
      <Container className="flex h-14 items-center gap-1 md:gap-4">
        <Suspense
          fallback={
            <div className="-ml-2 md:hidden">
              <LoadingRegion label={t("loadingMenu")}>
                <Skeleton className="size-10" />
              </LoadingRegion>
            </div>
          }
        >
          <MobileMenu
            className="-ml-2 md:hidden"
            logo={<Logo className="-ml-2 px-2" />}
          />
        </Suspense>
        <Logo markOnly className="w-10 justify-center md:hidden" />
        <Logo className="hidden md:inline-flex" />
        <Suspense
          fallback={
            <div className="hidden md:block">
              <LoadingRegion label={t("loadingNavigation")}>
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
          <IconLink href="/search" label={t("search")}>
            <Search />
          </IconLink>
          <SearchPanel className={PANEL} />
          <Suspense
            fallback={
              <LoadingRegion label={t("loadingAccount")}>
                <Skeleton className="h-10 w-28 md:w-32" />
              </LoadingRegion>
            }
          >
            <AccountTools />
          </Suspense>
        </div>
      </Container>
    </header>
  );
}

async function AccountTools() {
  const user = await getCurrentUser();
  const t = await getTranslations("layout.siteHeader");
  const levels = await getTranslations("lib.levels");
  const roles = await getTranslations("lib.db.roles");
  return (
    <>
      {user ? (
        <>
          <Suspense
            fallback={
              <LoadingRegion label={t("loadingMessages")}>
                <Skeleton className="size-10" />
              </LoadingRegion>
            }
          >
            <MessageTools userId={user.id} />
          </Suspense>
          <Suspense
            fallback={
              <LoadingRegion label={t("loadingAlerts")}>
                <Skeleton className="size-10" />
              </LoadingRegion>
            }
          >
            <AlertTools userId={user.id} />
          </Suspense>
          <UserMenu
            lite={await getLiteState()}
            avatar={<UserAvatar user={user.member} size="md" link={false} />}
            user={{
              id: user.id,
              username: user.username,
              title:
                (can(user, "customTitle") && user.customTitle) ||
                (user.role === "member"
                  ? levels(titleKeyForLevel(user.level.level))
                  : roles(user.role)),
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
            {t("login")}
          </Link>
          <Link
            href="/register"
            className={cn(buttonVariants(), "h-10 px-3 md:h-8")}
          >
            {t("register")}
          </Link>
        </>
      )}
    </>
  );
}

async function MessageTools({ userId }: { userId: number }) {
  await io();
  const t = await getTranslations("layout.siteHeader");
  const [conversations, unread] = await Promise.all([
    getConversations(userId),
    getUnreadCounts(userId),
  ]);
  return (
    <>
      <IconLink
        href="/conversations"
        label={t("conversations")}
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
  await io();
  const t = await getTranslations("layout.siteHeader");
  const [notifications, unread] = await Promise.all([
    getNotifications(userId),
    getUnreadCounts(userId),
  ]);
  return (
    <>
      <IconLink
        href="/notifications"
        label={t("notifications")}
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
