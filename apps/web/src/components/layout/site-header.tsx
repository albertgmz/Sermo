import { LogIn, Search } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { LoadingRegion } from "@/components/forum/skeletons";
import { AccountMenu } from "@/components/layout/account-menu";
import { Container } from "@/components/layout/container";
import { CreateButton } from "@/components/layout/create-button";
import { GuestMenu } from "@/components/layout/guest-menu";
import { getViewerCard } from "@/components/layout/header-data";
import { headerIconClass } from "@/components/layout/header-icon-class";
import { SearchPanel } from "@/components/layout/header-panels";
import { Logo } from "@/components/layout/logo";
import { NarrowToggle } from "@/components/layout/narrow-toggle";
import { toNavItems } from "@/components/layout/nav-server";
import { HeaderNav, MobileMenu } from "@/components/layout/site-nav";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getLiteState } from "@/lib/lite-mode";
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
          <NarrowToggle />
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
      {/* A guest's Create only leads to sign-in: on a tablet that room goes to the sign-in buttons. */}
      <span className={viewer.user ? "contents" : "hidden lg:contents"}>
        <CreateButton variant="header" member={!!viewer.user} />
      </span>
      {viewer.user && card ? (
        <AccountMenu />
      ) : (
        <>
          <GuestMenu lite={await getLiteState()} />
          <Link
            href="/login"
            className={cn(
              buttonVariants({ variant: "outline" }),
              "h-10 w-10 px-0 lg:w-auto lg:px-3",
            )}
          >
            <LogIn aria-hidden="true" className="lg:hidden" />
            <span className="sr-only lg:not-sr-only">{t("login")}</span>
          </Link>
          <Link href="/register" className={cn(buttonVariants(), "h-10 px-3")}>
            {t("register")}
          </Link>
        </>
      )}
    </>
  );
}
