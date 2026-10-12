import { useTranslations } from "next-intl";
import type { NotificationEntry } from "@/app/(main)/notifications/entries";
import {
  type ConversationItem,
  ConversationPreview,
} from "@/components/forum/conversation-preview";
import { NotificationRow } from "@/components/forum/notification-row";
import type { MemberView } from "@/lib/sermo/views";

const emptyClass = "px-4 py-8 text-center text-sm text-muted-foreground";

const listClass = "max-h-96 divide-y divide-border overflow-y-auto";

// The rows of the messages panel, drawn on the server once the visitor has opened it.
export function MessageRows({
  conversations,
  member,
}: {
  conversations: ConversationItem[];
  member: (id: number) => MemberView;
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
              member={member(conversation.lastMessage.user.id)}
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
      {notifications.map(({ item, href, emoji }) => (
        <li key={item.id}>
          <NotificationRow
            item={item}
            href={href}
            emoji={emoji}
            member={member}
          />
        </li>
      ))}
    </ul>
  ) : (
    <p className={emptyClass}>{t("empty")}</p>
  );
}
