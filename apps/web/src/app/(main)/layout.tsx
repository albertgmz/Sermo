import { useTranslations } from "next-intl";
import { Suspense } from "react";
import { LoadingRegion } from "@/components/forum/skeletons";
import { MobileNav } from "@/components/layout/mobile-nav";
import { PageBackdrop } from "@/components/layout/page-backdrop";
import { SiteAccent } from "@/components/layout/site-accent";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { StaffBar } from "@/components/layout/staff-bar";
import { Skeleton } from "@/components/ui/skeleton";
import { getUnreadCounts } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";

async function Chrome() {
  const user = await getCurrentUser();
  return (
    <>
      <SiteAccent user={user} />
      <StaffBar user={user} />
    </>
  );
}

async function MobileNavigation() {
  const user = await getCurrentUser();
  const unread = user
    ? await getUnreadCounts(user.id)
    : { conversations: 0, notifications: 0 };
  return <MobileNav user={user && { id: user.id }} unread={unread} />;
}

export default function MainLayout({ children }: LayoutProps<"/">) {
  const t = useTranslations("home.layout");
  return (
    <div className="flex min-h-dvh flex-1 flex-col pb-(--spacing-mobile-nav) md:pb-0">
      <Suspense>
        <Chrome />
      </Suspense>
      <SiteHeader />
      <Suspense
        fallback={
          <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/80 pb-[env(safe-area-inset-bottom)] backdrop-blur-lg md:hidden">
            <LoadingRegion label={t("loadingNavigation")}>
              <div
                aria-hidden="true"
                className="mx-auto grid h-14 max-w-lg grid-cols-5"
              >
                {[1, 2, 3, 4, 5].map((item) => (
                  <div
                    key={item}
                    className="flex flex-col items-center justify-center gap-1"
                  >
                    <Skeleton className="size-5" />
                    <Skeleton className="h-2.5 w-8" />
                  </div>
                ))}
              </div>
            </LoadingRegion>
          </div>
        }
      >
        <MobileNavigation />
      </Suspense>
      <div className="relative isolate flex flex-1 flex-col">
        <PageBackdrop />
        <main className="flex-1">{children}</main>
        <SiteFooter />
      </div>
    </div>
  );
}
