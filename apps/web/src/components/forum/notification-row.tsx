import { Bell } from "lucide-react";
import { useTranslations } from "next-intl";
import { NotificationLink } from "@/app/[locale]/(main)/notifications/notification-link";
import { RelativeTime } from "@/components/forum/relative-time";
import { UnreadDot } from "@/components/forum/unread-dot";
import { UserAvatar } from "@/components/forum/user-avatar";
import type { MemberView } from "@/lib/sermo/views";
import { cn } from "@/lib/utils";

// The message of each notification type the backend can send (its registry, by id). A type
// that is not listed here is drawn with the neutral line.
const TEXTS = {
  "thread.watched": "threadWatched",
  "node.thread": "nodeThread",
  "node.post": "nodePost",
  "content.quoted": "contentQuoted",
  "content.mentioned": "contentMentioned",
  "content.reaction": "contentReaction",
  "profile.post": "profilePost",
  "profile.comment": "profileComment",
  "profile.commented": "profileCommented",
  "member.thread": "memberThread",
  "member.followed": "memberFollowed",
  "conversation.added": "conversationAdded",
  "conversation.message": "conversationMessage",
  "moderation.content": "moderationContent",
  "moderation.member": "moderationMember",
  "report.resolved": "reportResolved",
  "moderator.report": "moderatorReport",
  "moderator.approval": "moderatorApproval",
  "member.groups": "memberGroups",
  announcement: "announcement",
  "account.security": "accountSecurity",
} as const;

// What the row needs of a backend notification.
export type NotificationItem = {
  id: number;
  type: string;
  contentType: string;
  actors: { id: number; username: string }[];
  actorCount: number;
  contentTitle: string | null;
  data: Record<string, unknown>;
  createdAt: string;
  read: boolean;
};

const text = (value: unknown) => (typeof value === "string" ? value : "");

export function NotificationRow({
  item,
  href,
  emoji = "",
  reaction = "",
  member,
  size = "md",
}: {
  item: NotificationItem;
  href: string;
  emoji?: string;
  // The title of the reaction a reaction notification is about.
  reaction?: string;
  member: (id: number) => MemberView;
  size?: "md" | "lg";
}) {
  const t = useTranslations("notifications.notificationRow");
  const [first, second] = item.actors;
  const key = TEXTS[item.type as keyof typeof TEXTS] ?? "unknown";
  const name = (actor: { username: string } | undefined) => () => (
    <span className="font-medium">{actor?.username}</span>
  );
  const shown = Math.min(item.actors.length, 2);
  const actors = first
    ? t.rich("actors", {
        shown,
        others: Math.max(0, item.actorCount - shown),
        first: name(first),
        second: name(second),
      })
    : t("someone");
  // The reason or message a moderator attached to what happened to the member.
  const detail = text(item.data.message) || text(item.data.reason);
  return (
    <div
      className={cn(
        "relative flex items-start gap-3 px-4 py-3 transition-colors hover:bg-muted/50",
        !item.read && "bg-primary/5",
      )}
    >
      {first ? (
        <UserAvatar user={member(first.id)} size={size} link={false} />
      ) : (
        <span
          aria-hidden="true"
          className={cn(
            "flex shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground",
            size === "lg" ? "size-10" : "size-8",
          )}
        >
          <Bell className="size-4" />
        </span>
      )}
      <span className="min-w-0 flex-1 text-sm [overflow-wrap:anywhere]">
        <NotificationLink
          id={item.id}
          href={href}
          read={item.read}
          className={cn(
            "after:absolute after:inset-0",
            item.read && "text-muted-foreground",
          )}
        >
          {t.rich(`texts.${key}`, {
            actors: () => actors,
            titled: item.contentTitle ? "yes" : "no",
            title: item.contentTitle ?? "",
            kind: item.contentType,
            emoji,
            named: reaction ? "yes" : "no",
            reaction,
            action: text(item.data.action),
            state: text(item.data.state),
          })}
        </NotificationLink>
        {detail && (
          <span className="mt-0.5 block text-xs text-muted-foreground">
            {detail}
          </span>
        )}
        <RelativeTime
          date={item.createdAt}
          className="mt-0.5 block text-xs text-muted-foreground"
        />
      </span>
      {!item.read && <UnreadDot className="mt-1.5" />}
    </div>
  );
}
