import Link from "next/link";
import { RelativeTime } from "@/components/forum/relative-time";
import { UnreadDot } from "@/components/forum/unread-dot";
import { UserAvatar } from "@/components/forum/user-avatar";
import { UserLink } from "@/components/forum/user-link";
import type { ConversationView, MessageView } from "@/lib/db";
import { cn } from "@/lib/utils";

function plain(markdown: string) {
  return markdown
    .replace(/[*_~`>#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Linked previews need a positioned row, without an enclosing link.
// `ringClassName` matches the avatar ring to the surface the row sits on.
export function ConversationPreview({
  conversation,
  viewerId,
  linked = false,
  ringClassName = "ring-card",
}: {
  conversation: Pick<
    ConversationView,
    "id" | "title" | "participants" | "unread"
  > & {
    lastMessage: Pick<MessageView, "author" | "body" | "createdAt">;
  };
  viewerId: number;
  linked?: boolean;
  ringClassName?: string;
}) {
  const others = conversation.participants.filter(
    (participant) => participant.id !== viewerId,
  );
  const last = conversation.lastMessage;
  return (
    <>
      <span className="flex w-10 shrink-0 justify-center -space-x-3">
        {others.slice(0, 2).map((other) => (
          <UserAvatar
            key={other.id}
            user={other}
            size={others.length > 1 ? "md" : "lg"}
            link={false}
            className={cn("ring-2", ringClassName)}
          />
        ))}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-sm",
              conversation.unread ? "font-semibold" : "font-medium",
            )}
          >
            {linked ? (
              <Link
                href={`/conversations/${conversation.id}`}
                className="after:absolute after:inset-0"
              >
                {conversation.title}
              </Link>
            ) : (
              conversation.title
            )}
          </span>
          <RelativeTime
            date={last.createdAt}
            className="shrink-0 text-xs text-muted-foreground"
          />
        </span>
        <span className="mt-0.5 flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            {linked ? (
              <UserLink user={last.author} className="relative z-10" />
            ) : (
              last.author.username
            )}
            : {plain(last.body)}
          </span>
          {conversation.unread && <UnreadDot />}
        </span>
      </span>
    </>
  );
}
