import { Suspense } from "react";
import { AcceptanceGate } from "@/components/forum/acceptance-gate";
import { AwaitingNotice } from "@/components/forum/awaiting-notice";
import { NoticeBanner } from "@/components/forum/notice-banner";
import { ShareNotice } from "@/components/forum/share-notice";
import { AnalyticsTag } from "@/components/layout/analytics-tag";
import { ClientMessages } from "@/components/layout/client-messages";
import { CountersPoll } from "@/components/layout/counters-poll";
import { HashTarget } from "@/components/layout/hash-target";
import { getAccent, getCounters } from "@/components/layout/header-data";
import { LocaleSyncGate } from "@/components/layout/locale-sync-gate";
import { MobileNav } from "@/components/layout/mobile-nav";
import { MobileNavSkeleton } from "@/components/layout/mobile-nav-skeleton";
import { hideClosedRegistration, mobileItems } from "@/components/layout/nav";
import { toNavItems } from "@/components/layout/nav-server";
import { PageBackdrop } from "@/components/layout/page-backdrop";
import { SessionNotice } from "@/components/layout/session-notice";
import { ShortcutsGate } from "@/components/layout/shortcuts-gate";
import { ViewerAccent } from "@/components/layout/site-accent";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { MAIN_ID, SkipLink } from "@/components/layout/skip-link";
import {
  pendingBadge,
  StaffBar,
  staffLinks,
} from "@/components/layout/staff-bar";
import { ThemeSyncGate } from "@/components/layout/theme-sync-gate";
import { ViewerScope } from "@/components/layout/viewer-scope";
import { getNavigation } from "@/lib/sermo/navigation";
import { getViewer } from "@/lib/sermo/session";
import { getSite } from "@/lib/sermo/site";

// The pages that hold the site's fixed text (privacy, terms, legal notice, rules, contact, the
// cookie policy and the pages an administrator writes) have the forum's frame, but not its
// boundaries around the page: the page is part of the first HTML, so a reader without JavaScript (a
// crawler, a policy checker) gets the whole text. The forum's layout streams every page behind a
// boundary and a loading screen, which such a reader never sees replaced. No floating prompts here
// (the app card, One Tap): a policy page asks nothing of its reader.

async function Chrome() {
  const [viewer, accent] = await Promise.all([getViewer(), getAccent()]);
  const links = staffLinks(viewer);
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
  const [{ user }, navigation, site, unread] = await Promise.all([
    getViewer(),
    getNavigation(),
    getSite(),
    getCounters(),
  ]);
  const entries = toNavItems(navigation.mobile, user && `/members/${user.id}`);
  return (
    <>
      {user && <CountersPoll drawn={unread} />}
      <MobileNav
        items={mobileItems(
          hideClosedRegistration(entries, site.registration.open),
        )}
        unread={unread}
        member={!!user}
      />
    </>
  );
}

export default function PolicyLayout({ children }: LayoutProps<"/[locale]">) {
  return (
    <ClientMessages
      namespaces={[
        "editor.editor",
        "forum.attachmentField",
        "forum.bbCode",
        "forum.composer",
        "forum.createFlow",
        "forum.forumChoicePanel",
        "forum.memberActions",
        "forum.memberCard",
        "forum.memberCardTrigger",
        "forum.mentionMenu",
        "forum.poll",
        "forum.shareButton",
        "forum.threadComposer",
        "forum.threadFields",
        "forum.threadTags",
        "layout.createButton",
        "layout.guestMenu",
        "layout.headerPanel",
        "layout.headerPanels",
        "layout.languageSwitcher",
        "layout.lazyPopup",
        "layout.mobileNav",
        "layout.narrowToggle",
        "layout.noticeBanner",
        "layout.shortcuts",
        "layout.siteNav",
        "layout.themeControl",
        "layout.userMenu",
        "lib.errors",
        "lite.menuItem",
        "lite.status",
        "members.postComposer",
        "members.wallButtons",
        "skeletons.skeletons",
        "ui.dialog",
        "ui.sheet",
      ]}
    >
      <div
        data-forum-layout=""
        className="flex min-h-dvh flex-1 flex-col pb-(--spacing-mobile-nav) md:pb-0"
      >
        <SkipLink />
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
          <ThemeSyncGate />
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
        <Suspense fallback={<MobileNavSkeleton />}>
          <MobileNavigation />
        </Suspense>
        <div
          data-forum-body=""
          className="relative isolate flex flex-1 flex-col"
        >
          <PageBackdrop />
          <main
            id={MAIN_ID}
            tabIndex={-1}
            className="min-h-[calc(100svh-3.5rem)] flex-1 outline-none"
          >
            {/* No boundary: the page waits for the gate, which for a guest reads only the request.
              A member who has terms or rules to accept gets the gate instead of the page. */}
            <AcceptanceGate>{children}</AcceptanceGate>
          </main>
          <SiteFooter />
        </div>
        <ShareNotice />
      </div>
    </ClientMessages>
  );
}
