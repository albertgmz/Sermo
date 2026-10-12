import {
  conversationsGet,
  conversationsListMessages,
} from "@sermo/core/contracts";
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Hourglass,
  Lock,
  LogOut,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import type * as z from "zod";
import { react } from "@/app/(main)/actions";
import { ConversationSync } from "@/app/(main)/conversations/[id]/conversation-sync";
import { LeaveForm } from "@/app/(main)/conversations/[id]/leave-form";
import { MessagesSkeleton } from "@/app/(main)/conversations/[id]/messages-skeleton";
import { ReplyForm } from "@/app/(main)/conversations/[id]/reply-form";
import { HtmlContent } from "@/components/forum/html-content";
import { ReactionButton } from "@/components/forum/reaction-button";
import { ReactionSummary } from "@/components/forum/reaction-summary";
import { loadReactionUsers } from "@/components/forum/reaction-users-action";
import { RelativeTime } from "@/components/forum/relative-time";
import { LoadingRegion } from "@/components/forum/skeletons";
import { UserAvatar } from "@/components/forum/user-avatar";
import { UserLink } from "@/components/forum/user-link";
import { buttonVariants } from "@/components/ui/button";
import { read } from "@/lib/sermo/client";
import { parseId } from "@/lib/sermo/ids";
import { membersFor } from "@/lib/sermo/members";
import {
  getReactionTypes,
  pickerTypes,
  reactionsView,
} from "@/lib/sermo/reactions";
import { getViewer } from "@/lib/sermo/session";
import { cn } from "@/lib/utils";

// A page of messages; the backend's default is smaller than a conversation usually needs.
const MESSAGES_PER_PAGE = 50;

type Conversation = z.output<typeof conversationsGet.output>;

function conversationIdOf(raw: string) {
  const id = parseId(raw);
  if (id === null) notFound();
  return id;
}

function MessageNote({
  icon: Icon,
  children,
}: {
  icon: typeof Hourglass;
  children: React.ReactNode;
}) {
  return (
    <p className="mt-1 flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
      <Icon aria-hidden="true" className="size-4 shrink-0" />
      {children}
    </p>
  );
}

function Header({
  conversation,
  member,
}: {
  conversation: Conversation;
  member: Awaited<ReturnType<typeof membersFor>>;
}) {
  const t = useTranslations("conversations.conversation");
  return (
    <header className="flex min-h-14 flex-wrap items-center gap-1 border-b px-2 py-2 lg:px-4">
      <Link
        href="/conversations"
        aria-label={t("aria.back")}
        className="flex size-10 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground lg:hidden"
      >
        <ArrowLeft className="size-5" />
      </Link>
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-sm font-semibold">{conversation.title}</h1>
        <p className="truncate text-xs text-muted-foreground">
          {conversation.participants.map((participant, index) => (
            <span key={participant.user.id}>
              {index > 0 && t("participantSeparator")}
              <UserLink user={member(participant.user.id)} />
              {participant.state === "left" && <> {t("left")}</>}
            </span>
          ))}
        </p>
      </div>
      <LeaveForm
        conversationId={conversation.id}
        label={t("leave")}
        ariaLabel={t("aria.leave")}
      >
        <LogOut />
      </LeaveForm>
    </header>
  );
}

export default async function ConversationPage({
  params,
  searchParams,
}: PageProps<"/conversations/[id]">) {
  const [{ id: raw }, { cursor }] = await Promise.all([params, searchParams]);
  const conversationId = conversationIdOf(raw);
  const [conversation, { permissions }, t] = await Promise.all([
    read(conversationsGet, { conversationId }),
    getViewer(),
    getTranslations("conversations.conversation"),
  ]);
  const member = await membersFor(
    conversation.participants.map((participant) => participant.user),
  );

  return (
    <div className="flex min-h-[calc(100dvh-7rem-env(safe-area-inset-bottom))] flex-col md:min-h-[calc(100dvh-3.5rem)] lg:h-full lg:min-h-0">
      <Header conversation={conversation} member={member} />
      <Suspense
        fallback={
          <LoadingRegion label={t("aria.loadingMessages")}>
            <MessagesSkeleton />
          </LoadingRegion>
        }
      >
        <Messages
          conversation={conversation}
          cursor={typeof cursor === "string" ? cursor : undefined}
          canReact={permissions.canReact}
        />
      </Suspense>

      {conversation.canReply ? (
        <ReplyForm
          conversationId={conversation.id}
          placeholder={t("placeholder")}
          submitLabel={t("submit")}
          className="sticky bottom-(--spacing-mobile-nav) z-10 border-t bg-background p-2 md:bottom-0 lg:static lg:bg-transparent lg:p-3"
        />
      ) : (
        <div className="sticky bottom-(--spacing-mobile-nav) z-10 border-t bg-background p-2 md:bottom-0 lg:static lg:bg-transparent lg:p-3">
          <MessageNote icon={Lock}>{t("cannotReply")}</MessageNote>
        </div>
      )}
    </div>
  );
}

async function Messages({
  conversation,
  cursor,
  canReact,
}: {
  conversation: Conversation;
  cursor: string | undefined;
  canReact: boolean;
}) {
  const [{ items: newestFirst, nextCursor }, { user }, reactionTypes, t] =
    await Promise.all([
      read(conversationsListMessages, {
        conversationId: conversation.id,
        order: "newest",
        cursor,
        limit: MESSAGES_PER_PAGE,
      }),
      getViewer(),
      getReactionTypes(),
      getTranslations("conversations.conversation"),
    ]);
  // The backend lists from the newest end; the page reads from the oldest of its messages down.
  const messages = newestFirst.toReversed();
  const member = await membersFor(messages.map((message) => message.author));
  const picker = canReact ? pickerTypes(reactionTypes) : [];
  const link = cn(buttonVariants({ variant: "outline" }), "mx-4 mt-4 h-10");

  return (
    <div className="flex-1 pb-4 lg:overflow-y-auto">
      {nextCursor && (
        <Link
          href={`/conversations/${conversation.id}?cursor=${encodeURIComponent(nextCursor)}`}
          className={link}
        >
          <ChevronUp />
          {t("earlier")}
        </Link>
      )}
      <ol>
        {messages.map((message, index) => {
          const grouped = messages[index - 1]?.author.id === message.author.id;
          const author = member(message.author.id);
          return (
            <li
              key={message.id}
              id={`message-${message.id}`}
              className={cn(
                "flex scroll-mt-4 gap-3 px-4",
                grouped ? "pt-1.5" : "pt-4",
              )}
            >
              <div className="w-10 shrink-0">
                {!grouped && <UserAvatar user={author} size="lg" />}
              </div>
              <div className="min-w-0 flex-1">
                {!grouped && (
                  <p className="mb-0.5 flex flex-wrap items-center gap-x-1.5 text-sm">
                    <UserLink user={author} />
                    <span aria-hidden="true" className="text-muted-foreground">
                      {t("authorSeparator")}
                    </span>
                    <RelativeTime
                      date={message.createdAt}
                      className="text-xs text-muted-foreground"
                    />
                  </p>
                )}
                {message.state === "moderated" && (
                  <MessageNote icon={Hourglass}>
                    {t("awaitingApproval")}
                  </MessageNote>
                )}
                {message.state === "deleted" && (
                  <MessageNote icon={Trash2}>{t("deleted")}</MessageNote>
                )}
                <HtmlContent>{message.bodyHtml}</HtmlContent>
                <ReactionSummary
                  reactions={reactionsView(message.reactions, reactionTypes)}
                  loadUsers={loadReactionUsers.bind(
                    null,
                    "conversation_message",
                    message.id,
                  )}
                  size="sm"
                  className="-ml-1"
                />
              </div>
              <ReactionButton
                action={react.bind(null, "message", message.id)}
                total={message.reactions.total}
                viewerTypeId={message.reactions.mine}
                types={message.state === "visible" ? picker : []}
                viewerId={user?.id ?? null}
                authorId={message.author.id}
                size="sm"
                className="-mr-2 shrink-0"
              />
            </li>
          );
        })}
      </ol>
      {cursor ? (
        <Link href={`/conversations/${conversation.id}`} className={link}>
          <ChevronDown />
          {t("newest")}
        </Link>
      ) : (
        <ConversationSync
          key={messages.length}
          id={conversation.id}
          unread={conversation.isUnread}
        />
      )}
    </div>
  );
}
