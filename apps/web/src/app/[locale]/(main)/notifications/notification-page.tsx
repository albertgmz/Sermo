import { notificationsList } from "@sermo/core/contracts";
import { notificationEntries } from "@/app/[locale]/(main)/notifications/entries";
import { NotificationRow } from "@/components/forum/notification-row";
import type { ListPage } from "@/lib/list-pages";
import { read } from "@/lib/sermo/client";

// One page of the member's notifications, drawn: the list's first page and each page the browser
// asks for. The unread count is the backend's at the time of the read.
export async function notificationsPage(
  cursor?: string,
  reader: typeof read = read,
): Promise<{ page: ListPage; unreadCount: number }> {
  const list = await reader(notificationsList, { cursor });
  const { entries, member } = await notificationEntries(list.items);
  return {
    unreadCount: list.unreadCount,
    page: {
      nextCursor: list.nextCursor,
      rows: entries.map(({ item, href, emoji }) => ({
        key: String(item.id),
        node: (
          <NotificationRow
            item={item}
            href={href}
            emoji={emoji}
            member={member}
            size="lg"
          />
        ),
      })),
    },
  };
}
