import { notificationsList } from "@sermo/core/contracts";
import { Bell, CheckCheck, ChevronDown } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { notificationEntries } from "@/app/(main)/notifications/entries";
import { MarkAllReadForm } from "@/app/(main)/notifications/mark-all-read";
import { EmptyState } from "@/components/forum/empty-state";
import { NotificationRow } from "@/components/forum/notification-row";
import { PageLayout } from "@/components/layout/page-layout";
import { buttonVariants } from "@/components/ui/button";
import { read } from "@/lib/sermo/client";
import { NOINDEX } from "@/lib/sermo/seo";
import { cn } from "@/lib/utils";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("notifications.notifications");
  return {
    title: t("metaTitle"),
    robots: NOINDEX,
  };
}

export default async function NotificationsPage({
  searchParams,
}: PageProps<"/notifications">) {
  const { cursor } = await searchParams;
  const list = await read(notificationsList, {
    cursor: typeof cursor === "string" ? cursor : undefined,
  });
  const [{ entries, member }, t] = await Promise.all([
    notificationEntries(list.items),
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
            {t("notifications", { count: list.unreadCount })}
          </p>
        </div>
        {entries.length > 0 && (
          <MarkAllReadForm
            variant="outline"
            disabled={list.unreadCount === 0}
            className="h-10 px-3 md:h-8"
          >
            <CheckCheck />
            {t("markAllRead")}
          </MarkAllReadForm>
        )}
      </div>

      <section className="mt-4 overflow-hidden rounded-lg border bg-card">
        {entries.length === 0 ? (
          <EmptyState
            icon={Bell}
            title={t("emptyTitle")}
            description={t("emptyDescription")}
          />
        ) : (
          <ul className="divide-y divide-border">
            {entries.map(({ item, href, emoji }) => (
              <li key={item.id}>
                <NotificationRow
                  item={item}
                  href={href}
                  emoji={emoji}
                  member={member}
                  size="lg"
                />
              </li>
            ))}
          </ul>
        )}
      </section>
      {list.nextCursor && (
        <Link
          href={`/notifications?cursor=${encodeURIComponent(list.nextCursor)}`}
          scroll={false}
          className={cn(
            buttonVariants({ variant: "outline" }),
            "mt-3 h-10 w-full",
          )}
        >
          <ChevronDown />
          {t("nextPage")}
        </Link>
      )}
    </PageLayout>
  );
}
