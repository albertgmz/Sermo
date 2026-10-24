import { notificationsList } from "@sermo/core/contracts";
import { notificationEntries } from "@/app/[locale]/(main)/notifications/entries";
import { NotificationRow } from "@/components/forum/notification-row";
import { NumberedList } from "@/components/forum/numbered-list";
import { pagesOf } from "@/components/forum/page-window";
import type { ListRow } from "@/lib/list-pages";
import { read } from "@/lib/sermo/client";
import { NOTIFICATIONS_PER_PAGE } from "@/lib/sermo/page-sizes";

export const NOTIFICATIONS_PATH = "/notifications";

export type NotificationsPage = {
  rows: ListRow[];
  total: number;
  unreadCount: number;
};

// One numbered page of the member's alerts, drawn, with how many alerts the list holds (which
// numbers its pages). The unread count is the backend's at the time of the read.
export async function notificationsPage(
  page: number,
  reader: typeof read = read,
): Promise<NotificationsPage> {
  const list = await reader(notificationsList, { page });
  const { entries, member } = await notificationEntries(list.items);
  return {
    total: list.total ?? 0,
    unreadCount: list.unreadCount,
    rows: entries.map(({ item, href, emoji, reaction }) => ({
      key: String(item.id),
      node: (
        <NotificationRow
          item={item}
          href={href}
          emoji={emoji}
          reaction={reaction}
          member={member}
          size="lg"
        />
      ),
    })),
  };
}

// The part of the alerts page that turns with its pages (`PageSwitch`): the pagers and the alerts.
export function NotificationPages({
  page,
  list,
}: {
  page: number;
  list: NotificationsPage;
}) {
  return (
    <NumberedList
      page={page}
      pages={pagesOf(list.total, NOTIFICATIONS_PER_PAGE)}
      path={NOTIFICATIONS_PATH}
      rows={list.rows}
      className="overflow-hidden rounded-lg border bg-card"
    />
  );
}
