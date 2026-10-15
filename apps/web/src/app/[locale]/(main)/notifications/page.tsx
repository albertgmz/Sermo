import { Bell, CheckCheck } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { MarkAllReadForm } from "@/app/[locale]/(main)/notifications/mark-all-read";
import { moreNotifications } from "@/app/[locale]/(main)/notifications/more-notifications";
import { notificationsPage } from "@/app/[locale]/(main)/notifications/notification-page";
import { EmptyState } from "@/components/forum/empty-state";
import { PagedList } from "@/components/forum/paged-list";
import { PageLayout } from "@/components/layout/page-layout";
import { pagesParam } from "@/lib/list-pages";
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
  const { cursor: raw, pages } = await searchParams;
  const cursor = typeof raw === "string" ? raw : undefined;
  const [{ page: first, unreadCount }, t] = await Promise.all([
    notificationsPage(cursor),
    getTranslations("notifications.notifications"),
  ]);

  return (
    <PageLayout>
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
        <PagedList
          first={first}
          more={moreNotifications}
          pages={pagesParam(pages)}
          start={cursor}
          listKey={["notifications"]}
          hrefBase="/notifications"
          moreLabel={t("nextPage")}
          estimateSize={72}
          as="ul"
          className="mt-4 overflow-hidden rounded-lg border bg-card"
          moreClassName="mt-3"
        />
      )}
    </PageLayout>
  );
}
