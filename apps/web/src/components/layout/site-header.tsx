import { Search } from "lucide-react";
import { io } from "next/cache";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { LoadingRegion } from "@/components/forum/skeletons";
import { AccountMenu } from "@/components/layout/account-menu";
import { Container } from "@/components/layout/container";
import { getCounters, getViewerCard } from "@/components/layout/header-data";
import {
  AlertsPanel,
  headerIconClass,
  MessagesPanel,
  SearchPanel,
} from "@/components/layout/header-panels";
import { Logo } from "@/components/layout/logo";
import { toNavItems } from "@/components/layout/nav";
import { HeaderNav, MobileMenu } from "@/components/layout/site-nav";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getNavigation } from "@/lib/sermo/navigation";
import { getViewer } from "@/lib/sermo/session";
import { cn } from "@/lib/utils";

const PANEL = "hidden md:inline-flex";

function IconLink({
  href,
  label,
  children,
}: {
  href: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-label={label}
      className={cn(headerIconClass, "md:hidden")}
    >
      {children}
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
          <MenuNavigation />
        </Suspense>
        <Logo markOnly className="w-10 justify-center md:hidden" />
        <Logo className="hidden md:inline-flex" />
        <Suspense
          fallback={
            <div className="hidden md:block">
              <LoadingRegion label={t("loadingNavigation")}>
                <div className="flex h-10 items-center gap-1">
                  {[1, 2, 3, 4, 5].map((item) => (
                    <Skeleton key={item} className="h-10 w-16" />
                  ))}
                </div>
              </LoadingRegion>
            </div>
          }
        >
          <HeaderNavigation />
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

async function MenuNavigation() {
  const { header } = await getNavigation();
  return (
    <MobileMenu
      links={toNavItems(header)}
      className="-ml-2 md:hidden"
      logo={<Logo className="-ml-2 px-2" />}
    />
  );
}

async function HeaderNavigation() {
  const { header } = await getNavigation();
  return <HeaderNav links={toNavItems(header)} className="hidden md:flex" />;
}

async function AccountTools() {
  const [viewer, card] = await Promise.all([getViewer(), getViewerCard()]);
  const t = await getTranslations("layout.siteHeader");
  return (
    <>
      {viewer.user && card ? (
        <>
          <Suspense
            fallback={
              <LoadingRegion label={t("loadingMessages")}>
                <Skeleton className="size-10" />
              </LoadingRegion>
            }
          >
            <MessageTools />
          </Suspense>
          <Suspense
            fallback={
              <LoadingRegion label={t("loadingAlerts")}>
                <Skeleton className="size-10" />
              </LoadingRegion>
            }
          >
            <AlertTools />
          </Suspense>
          <AccountMenu />
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

// Messages and alerts open as panels at every width; the bottom bar of a phone links to their
// full pages.
async function MessageTools() {
  await io();
  const unread = await getCounters();
  return <MessagesPanel unread={unread.conversations} />;
}

async function AlertTools() {
  await io();
  const unread = await getCounters();
  return <AlertsPanel unread={unread.notifications} />;
}
