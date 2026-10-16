import { useTranslations } from "next-intl";
import { Suspense } from "react";
import { AcceptancePrompt } from "@/components/forum/acceptance-prompt";
import { AwaitingNotice } from "@/components/forum/awaiting-notice";
import { NoticeBanner } from "@/components/forum/notice-banner";
import { LoadingRegion } from "@/components/forum/skeletons";
import { AnalyticsTag } from "@/components/layout/analytics-tag";
import { CountersPoll } from "@/components/layout/counters-poll";
import { HashTarget } from "@/components/layout/hash-target";
import { getAccent, getCounters } from "@/components/layout/header-data";
import { LocaleSyncGate } from "@/components/layout/locale-sync-gate";
import { MobileNav } from "@/components/layout/mobile-nav";
import { mobileItems } from "@/components/layout/nav";
import { toNavItems } from "@/components/layout/nav-server";
import { PageBackdrop } from "@/components/layout/page-backdrop";
import { SessionNotice } from "@/components/layout/session-notice";
import { ShortcutsGate } from "@/components/layout/shortcuts-gate";
import { ViewerAccent } from "@/components/layout/site-accent";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import {
  pendingBadge,
  StaffBar,
  staffLinks,
} from "@/components/layout/staff-bar";
import { ViewerScope } from "@/components/layout/viewer-scope";
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
      <ViewerScope viewerId={viewer.user?.id ?? null} />
      <ViewerAccent accent={accent} />
      {viewer.user && (links.admin || links.moderation) && (
        <StaffBar
          admin={links.admin}
          moderation={links.moderation}
          moderationHref={links.moderationHref}
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
  return (
    <>
      {user && <CountersPoll drawn={unread} />}
      <MobileNav items={items} unread={unread} member={!!user} />
    </>
  );
}

export default function MainLayout({ children }: LayoutProps<"/[locale]">) {
  const t = useTranslations("home.layout");
  return (
    <div
      data-forum-layout=""
      className="flex min-h-dvh flex-1 flex-col pb-(--spacing-mobile-nav) md:pb-0"
    >
      <Suspense>
        <SessionNotice />
      </Suspense>
      <Suspense>
        <Chrome />
      </Suspense>
      <Suspense>
        <HashTarget />
      </Suspense>
      <Suspense>
        <LocaleSyncGate />
      </Suspense>
      <Suspense>
        <AnalyticsTag />
      </Suspense>
      <Suspense>
        <ShortcutsGate />
      </Suspense>
      <SiteHeader />
      <Suspense>
        <NoticeBanner />
      </Suspense>
      <Suspense>
        <AwaitingNotice />
      </Suspense>
      <Suspense>
        <AcceptancePrompt />
      </Suspense>
      <Suspense
        fallback={
          <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/80 pb-[env(safe-area-inset-bottom)] backdrop-blur-lg md:hidden">
            <LoadingRegion label={t("loadingNavigation")}>
              <div
                aria-hidden="true"
                className="mx-auto grid h-14 max-w-lg grid-cols-6"
              >
                {[1, 2, 3, 4, 5, 6].map((item) =>
                  item === 3 ? (
                    <div
                      key={item}
                      className="flex items-center justify-center"
                    >
                      <Skeleton className="size-11 rounded-full" />
                    </div>
                  ) : (
                    <div
                      key={item}
                      className="flex flex-col items-center justify-center gap-1"
                    >
                      <Skeleton className="size-5" />
                      <Skeleton className="h-2.5 w-8" />
                    </div>
                  ),
                )}
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
