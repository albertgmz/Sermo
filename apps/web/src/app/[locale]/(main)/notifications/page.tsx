import { Bell, CheckCheck } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AlertsViewed } from "@/app/[locale]/(main)/notifications/alerts-viewed";
import { MarkAllReadForm } from "@/app/[locale]/(main)/notifications/mark-all-read";
import {
  NOTIFICATIONS_PATH,
  NotificationPages,
  notificationsPage,
} from "@/app/[locale]/(main)/notifications/notification-page";
import { notificationsPageAction } from "@/app/[locale]/(main)/notifications/notifications-page-action";
import { EmptyState } from "@/components/forum/empty-state";
import { PageSwitch } from "@/components/forum/page-switch";
import {
  pageAddress,
  pageParam,
  pagesOf,
} from "@/components/forum/page-window";
import { PageLayout } from "@/components/layout/page-layout";
import { NOTIFICATIONS_PER_PAGE } from "@/lib/sermo/page-sizes";
import { NOINDEX } from "@/lib/sermo/seo";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("notifications.notifications");
  return {
    title: t("metaTitle"),
    robots: NOINDEX,
  };
}

export default async function NotificationsPage({
  searchParams,
}: PageProps<"/[locale]/notifications">) {
  const page = pageParam((await searchParams).page);
  const [first, t] = await Promise.all([
    notificationsPage(page),
    getTranslations("notifications.notifications"),
  ]);
  const { unreadCount } = first;
  // A page past the last one goes to the last one, as XenForo does.
  const pages = pagesOf(first.total, NOTIFICATIONS_PER_PAGE);
  if (page > pages) redirect(pageAddress(NOTIFICATIONS_PATH, {}, pages));

  return (
    <PageLayout>
      <AlertsViewed />
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("heading")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("notifications", { count: unreadCount })}
          </p>
        </div>
        {first.rows.length > 0 && (
          <MarkAllReadForm
            variant="outline"
            disabled={unreadCount === 0}
            className="h-10 px-3 md:h-8"
          >
            <CheckCheck />
            {t("markAllRead")}
          </MarkAllReadForm>
        )}
      </div>

      {first.rows.length === 0 ? (
        <section className="mt-4 overflow-hidden rounded-lg border bg-card">
          <EmptyState
            icon={Bell}
            title={t("emptyTitle")}
            description={t("emptyDescription")}
          />
        </section>
      ) : (
        <PageSwitch
          page={page}
          stamp={Date.now()}
          load={notificationsPageAction}
          className="mt-4"
        >
          <NotificationPages page={page} list={first} />
        </PageSwitch>
      )}
    </PageLayout>
  );
}
