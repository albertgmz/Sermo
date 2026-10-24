import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  type BookmarkItem,
  bookmarkHref,
} from "@/app/[locale]/(main)/account/bookmarks/bookmark-page";
import type { NotificationEntry } from "@/app/[locale]/(main)/notifications/entries";
import {
  type ConversationItem,
  ConversationPreview,
} from "@/components/forum/conversation-preview";
import { NotificationRow } from "@/components/forum/notification-row";
import { RelativeTime } from "@/components/forum/relative-time";
import type { Lookup } from "@/lib/sermo/authors";
import type { MemberView } from "@/lib/sermo/views";

const emptyClass = "px-4 py-8 text-center text-sm text-muted-foreground";

const listClass = "max-h-72 divide-y divide-border overflow-y-auto";

// The rows of the messages panel, drawn on the server once the visitor has opened it.
export function MessageRows({
  conversations,
  member,
}: {
  conversations: ConversationItem[];
  member: Lookup<MemberView>;
}) {
  const t = useTranslations("layout.headerPanels.messages");
  return conversations.length > 0 ? (
    <ul className={listClass}>
      {conversations.map((conversation) => (
        <li key={conversation.id}>
          <div className="relative flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/50">
            <ConversationPreview
              linked
              conversation={conversation}
              member={member(conversation.lastMessage.user)}
              ringClassName="ring-popover"
            />
          </div>
        </li>
      ))}
    </ul>
  ) : (
    <p className={emptyClass}>{t("empty")}</p>
  );
}

// The rows of the alerts panel, drawn on the server once the visitor has opened it.
export function AlertRows({
  notifications,
  member,
}: {
  notifications: NotificationEntry[];
  member: (id: number) => MemberView;
}) {
  const t = useTranslations("layout.headerPanels.alerts");
  return notifications.length > 0 ? (
    <ul className={listClass}>
      {notifications.map(({ item, href, emoji, reaction }) => (
        <li key={item.id}>
          <NotificationRow
            item={item}
            href={href}
            emoji={emoji}
            reaction={reaction}
            member={member}
          />
        </li>
      ))}
    </ul>
  ) : (
    <p className={emptyClass}>{t("empty")}</p>
  );
}

// The rows of the bookmarks tab, drawn on the server once the visitor has opened it.
export function BookmarkRows({ bookmarks }: { bookmarks: BookmarkItem[] }) {
  const t = useTranslations("layout.userMenu.bookmarks");
  const types = useTranslations("account.bookmarks.types");
  return bookmarks.length > 0 ? (
    <ul className={listClass}>
      {bookmarks.map((item) => (
        <li key={item.id}>
          <Link
            href={bookmarkHref(item)}
            className="flex min-h-14 flex-col justify-center px-4 py-2 transition-colors hover:bg-muted/50"
          >
            <span className="truncate text-sm font-medium">{item.title}</span>
            <span className="truncate text-xs text-muted-foreground">
              {types(item.contentType)}
              {" · "}
              <RelativeTime date={item.createdAt} />
            </span>
          </Link>
        </li>
      ))}
    </ul>
  ) : (
    <p className={emptyClass}>{t("empty")}</p>
  );
}
