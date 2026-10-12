import { Bell, CheckCheck } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { markAllRead } from "@/app/(main)/notifications/actions";
import { EmptyState } from "@/components/forum/empty-state";
import { NotificationRow } from "@/components/forum/notification-row";
import { PendingButton } from "@/components/forum/pending-button";
import { PageLayout } from "@/components/layout/page-layout";
import { getNotifications } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("notifications.notifications");
  return {
    title: t("metaTitle"),
  };
}

export default async function NotificationsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const notifications = await getNotifications(user.id);
  const unread = notifications.filter((item) => !item.read).length;
  const t = await getTranslations("notifications.notifications");

  return (
    <PageLayout>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("heading")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("notifications", { count: unread })}
          </p>
        </div>
        {notifications.length > 0 && (
          <form action={markAllRead}>
            <PendingButton
              variant="outline"
              disabled={unread === 0}
              className="h-10 px-3 md:h-8"
            >
              <CheckCheck />
              {t("markAllRead")}
            </PendingButton>
          </form>
        )}
      </div>

      <section className="mt-4 overflow-hidden rounded-lg border bg-card">
        {notifications.length === 0 ? (
          <EmptyState
            icon={Bell}
            title={t("emptyTitle")}
            description={t("emptyDescription")}
          />
        ) : (
          <ul className="divide-y divide-border">
            {notifications.map((item) => (
              <li key={item.id}>
                <NotificationRow item={item} size="lg" />
              </li>
            ))}
          </ul>
        )}
      </section>
    </PageLayout>
  );
}
