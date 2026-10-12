import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { react } from "@/app/(main)/actions";
import { ConversationSync } from "@/app/(main)/conversations/[id]/conversation-sync";
import { sendMessage } from "@/app/(main)/conversations/actions";
import { ClientIcons } from "@/components/forum/client-icons";
import { CompactComposer } from "@/components/forum/compact-composer";
import { Markdown } from "@/components/forum/markdown";
import { ReactionButton } from "@/components/forum/reaction-button";
import { ReactionSummary } from "@/components/forum/reaction-summary";
import { RelativeTime } from "@/components/forum/relative-time";
import { UserAvatar } from "@/components/forum/user-avatar";
import { UserLink } from "@/components/forum/user-link";
import { getConversation, getReactionTypes } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { cn } from "@/lib/utils";

export default async function ConversationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const [conversation, reactionTypes] = await Promise.all([
    getConversation(Number(id), user.id),
    getReactionTypes(),
  ]);
  if (!conversation) notFound();
  const { messages } = conversation;

  return (
    <div className="flex min-h-[calc(100dvh-7rem-env(safe-area-inset-bottom))] flex-col md:min-h-[calc(100dvh-3.5rem)] lg:h-full lg:min-h-0">
      <header className="flex min-h-14 items-center gap-1 border-b px-2 py-2 lg:px-4">
        <Link
          href="/conversations"
          aria-label="Back to conversations"
          className="flex size-10 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground lg:hidden"
        >
          <ArrowLeft className="size-5" />
        </Link>
        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold">
            {conversation.title}
          </h1>
          <p className="truncate text-xs text-muted-foreground">
            {conversation.participants.map((participant, index) => (
              <span key={participant.id}>
                {index > 0 && ", "}
                <UserLink user={participant} />
              </span>
            ))}
          </p>
        </div>
      </header>

      <div className="flex-1 pb-4 lg:overflow-y-auto">
        <ol>
          {messages.map((message, index) => {
            const grouped = messages[index - 1]?.authorId === message.authorId;
            return (
              <li
                key={message.id}
                className={cn("flex gap-3 px-4", grouped ? "pt-1.5" : "pt-4")}
              >
                <div className="w-10 shrink-0">
                  {!grouped && <UserAvatar user={message.author} size="lg" />}
                </div>
                <div className="min-w-0 flex-1">
                  {!grouped && (
                    <p className="mb-0.5 flex flex-wrap items-center gap-x-1.5 text-sm">
                      <UserLink user={message.author} />
                      <span
                        aria-hidden="true"
                        className="text-muted-foreground"
                      >
                        ·
                      </span>
                      <RelativeTime
                        date={message.createdAt}
                        className="text-xs text-muted-foreground"
                      />
                      <ClientIcons client={message.client} />
                    </p>
                  )}
                  <Markdown>{message.body}</Markdown>
                  <ReactionSummary
                    reactions={message.reactions}
                    size="sm"
                    className="-ml-1"
                  />
                </div>
                <ReactionButton
                  action={react.bind(null, "message", message.id)}
                  total={message.reactions.total}
                  viewerTypeId={message.reactions.viewerTypeId}
                  types={reactionTypes}
                  viewerId={user.id}
                  authorId={message.authorId}
                  size="sm"
                  className="-mr-2 shrink-0"
                />
              </li>
            );
          })}
        </ol>
        <ConversationSync
          key={messages.length}
          id={conversation.id}
          unread={conversation.unread}
        />
      </div>

      <CompactComposer
        action={sendMessage.bind(null, conversation.id)}
        placeholder="Write a message…"
        submitLabel="Send message"
        className="sticky bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-10 border-t bg-background p-2 md:bottom-0 lg:static lg:bg-transparent lg:p-3"
      />
    </div>
  );
}
