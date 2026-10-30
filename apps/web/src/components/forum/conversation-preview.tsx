import Link from "next/link";
import { useTranslations } from "next-intl";
import { GuestName } from "@/components/forum/guest-name";
import { StaticRelativeTime } from "@/components/forum/relative-time-static";
import { UnreadDot } from "@/components/forum/unread-dot";
import { UserAvatar } from "@/components/forum/user-avatar";
import type { AuthorRef } from "@/lib/sermo/authors";
import { conversationOpenHref } from "@/lib/sermo/open-links";
import type { MemberView } from "@/lib/sermo/views";
import { cn } from "@/lib/utils";

// What the row needs of a conversation summary from the backend.
export type ConversationItem = {
  id: number;
  title: string;
  participantCount: number;
  isUnread: boolean;
  lastMessage: { sentAt: string; user: AuthorRef };
};

// Linked previews need a positioned row, without an enclosing link: the title's link covers the
// whole row, which is one target (the avatar and the name inside are neither links nor cards).
// `ringClassName` matches the avatar ring to the surface the row sits on.
export function ConversationPreview({
  conversation,
  member,
  linked = false,
  ringClassName = "ring-card",
}: {
  conversation: ConversationItem;
  // The member who wrote the last message.
  member: MemberView;
  linked?: boolean;
  ringClassName?: string;
}) {
  const t = useTranslations("conversations.conversationPreview");
  return (
    <>
      <span className="flex w-10 shrink-0 justify-center">
        <UserAvatar
          user={member}
          size="lg"
          link={false}
          className={cn("ring-2", ringClassName)}
        />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-sm",
              conversation.isUnread ? "font-semibold" : "font-medium",
            )}
          >
            {linked ? (
              <Link
                href={conversationOpenHref(conversation.id)}
                className="after:absolute after:inset-0"
              >
                {conversation.title}
              </Link>
            ) : (
              conversation.title
            )}
          </span>
          <StaticRelativeTime
            date={conversation.lastMessage.sentAt}
            className="shrink-0 text-xs text-muted-foreground"
          />
        </span>
        <span className="mt-0.5 flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            {t.rich("summary", {
              participants: conversation.participantCount,
              author: () =>
                member.guest ? (
                  <GuestName name={member.username || null} />
                ) : (
                  member.username
                ),
            })}
          </span>
          {conversation.isUnread && <UnreadDot />}
        </span>
      </span>
    </>
  );
}
