import { useTranslations } from "next-intl";
import { Suspense } from "react";
import { LoadingRegion } from "@/components/forum/skeletons";
import { getAccent, getCounters } from "@/components/layout/header-data";
import { MobileNav } from "@/components/layout/mobile-nav";
import { mobileItems, toNavItems } from "@/components/layout/nav";
import { PageBackdrop } from "@/components/layout/page-backdrop";
import { ViewerAccent } from "@/components/layout/site-accent";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import {
  pendingBadge,
  StaffBar,
  staffLinks,
} from "@/components/layout/staff-bar";
import { Skeleton } from "@/components/ui/skeleton";
import { getNavigation } from "@/lib/sermo/navigation";
import { getViewer } from "@/lib/sermo/session";

async function Chrome() {
  const [viewer, accent] = await Promise.all([getViewer(), getAccent()]);
  const links = staffLinks(viewer);
  // The header reads the counters too, in the same render: one call.
  const pending = links.moderation ? pendingBadge(await getCounters()) : null;
  return (
    <>
      <ViewerAccent accent={accent} />
      {viewer.user && (links.admin || links.moderation) && (
        <StaffBar
          admin={links.admin}
          moderation={links.moderation}
          pending={pending}
        />
      )}
    </>
  );
}

async function MobileNavigation() {
  const [{ user }, navigation] = await Promise.all([
    getViewer(),
    getNavigation(),
  ]);
  const unread = await getCounters();
  const items = mobileItems(
    toNavItems(navigation.mobile, user && `/members/${user.id}`),
  );
  return <MobileNav items={items} unread={unread} />;
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
