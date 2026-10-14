import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { LoadingRegion } from "@/components/forum/skeletons";
import { AccountMenu } from "@/components/layout/account-menu";
import { Container } from "@/components/layout/container";
import { getAccent } from "@/components/layout/header-data";
import { Logo } from "@/components/layout/logo";
import { SessionNotice } from "@/components/layout/session-notice";
import { ViewerAccent } from "@/components/layout/site-accent";
import { Skeleton } from "@/components/ui/skeleton";
import { StaffMenu } from "./mobile-menu";
import { StaffNavigation } from "./navigation";
import { getStaffNavigation } from "./navigation-data";
import { SectionTitle } from "./section-title";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("admin.shell");
  return {
    title: t("title"),
    robots: { index: false, follow: false },
  };
}

// The panel's frame, shared by /admin and /moderation: a slim top bar (the way back to the site,
// the section's title, the member's own menu) and the navigation, fixed at the side on a desktop
// and a drawer below it. The accent, the language and the LITE switches come from the root
// layout and `ViewerAccent`, as on the site.
export default function StaffLayout({ children }: LayoutProps<"/[locale]">) {
  const t = useTranslations("admin.shell");
  return (
    <div className="flex min-h-dvh flex-1 flex-col">
      <Suspense>
        <StaffAccent />
      </Suspense>
      <Suspense>
        <SessionNotice />
      </Suspense>
      <header className="sticky top-0 z-30 border-b bg-background">
        <Container className="flex h-14 items-center gap-1 sm:gap-3">
          <Suspense
            fallback={
              <LoadingRegion label={t("aria.loadingNavigation")}>
                <Skeleton className="-ml-2 size-10 lg:hidden" />
              </LoadingRegion>
            }
          >
            <DrawerNavigation />
          </Suspense>
          <Logo markOnly className="w-10 justify-center sm:hidden" />
          <Logo className="hidden sm:inline-flex" />
          <Suspense
            fallback={
              <LoadingRegion label={t("aria.loadingTitle")}>
                <div className="flex min-w-0 flex-1 items-center border-l pl-3">
                  <Skeleton className="h-4 w-24" />
                </div>
              </LoadingRegion>
            }
          >
            <CurrentTitle />
          </Suspense>
          <Suspense
            fallback={
              <LoadingRegion label={t("aria.loadingAccount")}>
                <Skeleton className="h-10 w-14" />
              </LoadingRegion>
            }
          >
            <AccountMenu />
          </Suspense>
        </Container>
      </header>
      <Container className="grid flex-1 lg:grid-cols-[16rem_minmax(0,1fr)] lg:gap-6">
        <aside className="hidden lg:block">
          <div className="sticky top-14 max-h-[calc(100dvh-3.5rem)] overflow-y-auto py-4 pr-2">
            <Suspense
              fallback={
                <LoadingRegion label={t("aria.loadingNavigation")}>
                  <div className="space-y-1">
                    {[1, 2, 3, 4, 5, 6].map((row) => (
                      <Skeleton key={row} className="h-10 w-full" />
                    ))}
                  </div>
                </LoadingRegion>
              }
            >
              <SideNavigation />
            </Suspense>
          </div>
        </aside>
        <main className="min-w-0 py-4 pb-8 lg:py-6">{children}</main>
      </Container>
    </div>
  );
}

async function StaffAccent() {
  return <ViewerAccent accent={await getAccent()} />;
}

async function DrawerNavigation() {
  return <StaffMenu sections={await getStaffNavigation()} />;
}

async function CurrentTitle() {
  return <SectionTitle sections={await getStaffNavigation()} />;
}

async function SideNavigation() {
  const [sections, t] = await Promise.all([
    getStaffNavigation(),
    getTranslations("admin.shell"),
  ]);
  return <StaffNavigation sections={sections} label={t("aria.navigation")} />;
}
