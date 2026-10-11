import { Suspense } from "react";
import { MobileNav } from "@/components/layout/mobile-nav";
import { PageBackdrop } from "@/components/layout/page-backdrop";
import { SiteAccent } from "@/components/layout/site-accent";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { StaffBar } from "@/components/layout/staff-bar";
import { getConversations, getNotifications, getUnreadCounts } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";

const PANEL_CONVERSATIONS = 5;
const PANEL_NOTIFICATIONS = 6;

async function Chrome() {
  const user = await getCurrentUser();
  const [unread, conversations, notifications] = user
    ? await Promise.all([
        getUnreadCounts(user.id),
        getConversations(user.id),
        getNotifications(user.id),
      ])
    : [{ conversations: 0, notifications: 0 }, [], []];
  return (
    <>
      <SiteAccent user={user} />
      <StaffBar user={user} />
      <SiteHeader
        user={user}
        unread={unread}
        conversations={conversations.slice(0, PANEL_CONVERSATIONS)}
        notifications={notifications.slice(0, PANEL_NOTIFICATIONS)}
      />
      <MobileNav user={user && { username: user.username }} unread={unread} />
    </>
  );
}

export default function MainLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-dvh flex-1 flex-col pb-[calc(3.5rem+env(safe-area-inset-bottom))] md:pb-0">
      <Suspense fallback={<div className="h-14 border-b" />}>
        <Chrome />
      </Suspense>
      <div className="relative isolate flex flex-1 flex-col">
        <PageBackdrop />
        <main className="flex-1">{children}</main>
        <SiteFooter />
      </div>
    </div>
  );
}
