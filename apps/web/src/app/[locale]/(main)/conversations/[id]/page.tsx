import {
  conversationsGet,
  conversationsListMessages,
  conversationsLocateMessage,
} from "@sermo/core/contracts";
import { ChevronUp, LogOut, Mail } from "lucide-react";
import { notFound } from "next/navigation";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import type * as z from "zod";
import { ConversationSync } from "@/app/[locale]/(main)/conversations/[id]/conversation-sync";
import { ConversationWidgets } from "@/app/[locale]/(main)/conversations/[id]/conversation-widgets";
import { LeaveForm } from "@/app/[locale]/(main)/conversations/[id]/leave-form";
import {
  LockedBadge,
  ReplyArea,
} from "@/app/[locale]/(main)/conversations/[id]/locked-state";
import { MarkReadProvider } from "@/app/[locale]/(main)/conversations/[id]/mark-read-state";
import { MarkUnreadForm } from "@/app/[locale]/(main)/conversations/[id]/mark-unread-form";
import { MessageItem } from "@/app/[locale]/(main)/conversations/[id]/message-item";
import { MessagesSkeleton } from "@/app/[locale]/(main)/conversations/[id]/messages-skeleton";
import { WidgetsSheet } from "@/app/[locale]/(main)/conversations/[id]/widgets-sheet";
import { pollMessages } from "@/app/[locale]/(main)/conversations/poll-messages";
import { BookmarkButton } from "@/components/forum/bookmark-button";
import { LiveTail, PendingBody } from "@/components/forum/live-tail";
import { LoadMore } from "@/components/forum/load-more";
import { PageBreadcrumb } from "@/components/forum/page-breadcrumb";
import { PostFrame } from "@/components/forum/post-frame";
import { LoadingRegion } from "@/components/forum/skeletons";
import { UserLink } from "@/components/forum/user-link";
import { getCounters } from "@/components/layout/header-data";
import { PageLayout } from "@/components/layout/page-layout";
import { POLL_MS } from "@/lib/poll-intervals";
import { bookmarkedAmong } from "@/lib/sermo/bookmarks";
import { call, read } from "@/lib/sermo/client";
import { SermoError } from "@/lib/sermo/errors";
import { parseId } from "@/lib/sermo/ids";
import { authorsFor, membersFor } from "@/lib/sermo/members";
import { getReactionTypes, pickerTypes } from "@/lib/sermo/reactions";
import { getMember } from "@/lib/sermo/session";

type Conversation = z.output<typeof conversationsGet.output>;
type Members = Awaited<ReturnType<typeof membersFor>>;

// What the end of this conversation is kept under while the page is open.
const tailKey = (conversationId: number) => `conversation:${conversationId}`;

function conversationIdOf(raw: string) {
  const id = parseId(raw);
  if (id === null) notFound();
  return id;
}

function Header({
  conversation,
  member,
  bookmarked,
}: {
  conversation: Conversation;
  member: Members;
  // Null when the bookmark state could not be read: no toggle is drawn.
  bookmarked: boolean | null;
}) {
  const t = useTranslations("conversations.conversation");
  return (
    <header>
      <PageBreadcrumb
        items={[
          { label: t("home"), href: "/" },
          { label: t("conversations"), href: "/conversations" },
        ]}
      />
      <div className="mt-1 flex flex-wrap items-start gap-x-3">
        {/* A long title keeps room to wrap: the buttons drop below it rather than squeeze it. */}
        <h1 className="min-w-0 flex-[1_1_14rem] text-2xl font-semibold tracking-tight [overflow-wrap:anywhere]">
          {conversation.title}
        </h1>
        {/* Beside the messages on a wide screen; behind this button below it. */}
        {conversation.isLocked && <LockedBadge />}
        <WidgetsSheet
          label={t("details.open")}
          title={t("details.title")}
          description={t("details.description")}
        >
          <ConversationWidgets conversation={conversation} member={member} />
        </WidgetsSheet>
        {bookmarked !== null && (
          <BookmarkButton
            contentType="conversation"
            contentId={conversation.id}
            bookmarked={bookmarked}
            className="max-sm:min-w-10"
            labelClassName="max-sm:sr-only"
          />
        )}
        <MarkUnreadForm
          conversationId={conversation.id}
          label={t("markUnread")}
        >
          <Mail />
        </MarkUnreadForm>
        <LeaveForm
          conversationId={conversation.id}
          label={t("leave")}
          ariaLabel={t("aria.leave")}
          texts={{
            warning: t("leaveDialog.warning"),
            legend: t("leaveDialog.legend"),
            accept: t("leaveDialog.accept"),
            ignore: t("leaveDialog.ignore"),
            confirm: t("leave"),
            cancel: t("leaveDialog.cancel"),
          }}
        >
          <LogOut />
        </LeaveForm>
      </div>
      {/* The full list is in the widgets; below the desktop layout they are behind the button. */}
      <p className="line-clamp-2 text-sm text-muted-foreground [overflow-wrap:anywhere] lg:hidden">
        {conversation.participants.map((participant, index) => (
          <span key={participant.user.id}>
            {index > 0 && t("participantSeparator")}
            <UserLink user={member(participant.user.id)} />
            {participant.state === "left" && <> {t("left")}</>}
          </span>
        ))}
      </p>
    </header>
  );
}

export default async function ConversationPage({
  params,
  searchParams,
}: PageProps<"/[locale]/conversations/[id]">) {
  const [{ id: raw }, { cursor, message }] = await Promise.all([
    params,
    searchParams,
  ]);
  const conversationId = conversationIdOf(raw);
  const [conversation, { permissions, resolvedPermissions }, bookmarks, t] =
    await Promise.all([
      read(conversationsGet, { conversationId }),
      getMember(),
      bookmarkedAmong("conversation", [conversationId]),
      getTranslations("conversations.conversation"),
    ]);
  const member = await membersFor(
    conversation.participants.map((participant) => participant.user),
  );

  return (
    <MarkReadProvider>
      <PageLayout
        className="pt-2"
        asideOnMobile="hidden"
        aside={
          <ConversationWidgets conversation={conversation} member={member} />
        }
      >
        <Header
          conversation={conversation}
          member={member}
          bookmarked={bookmarks ? bookmarks.toggle(conversation.id) : null}
        />
        <div className="mt-4">
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
              focus={typeof message === "string" ? parseId(message) : null}
              canReact={
                permissions.canReact &&
                resolvedPermissions["conversation.react"] !== false
              }
              viewList={resolvedPermissions["reaction.viewList"] !== false}
            />
          </Suspense>
        </div>

        {/* Where a message's Reply takes the member, and its Quote puts the message in the editor. */}
        <section
          id="reply"
          aria-label={t("aria.reply")}
          className="mt-4 scroll-mt-4"
        >
          <ReplyArea
            conversation={conversation}
            tailKey={tailKey(conversation.id)}
            canAttach={resolvedPermissions["conversation.attach"] !== false}
          />
        </section>
      </PageLayout>
    </MarkReadProvider>
  );
}

async function Messages({
  conversation,
  cursor: requested,
  focus,
  canReact,
  viewList,
}: {
  conversation: Conversation;
  cursor: string | undefined;
  // A message an address names, which the page of messages that holds it is opened at.
  focus: number | null;
  canReact: boolean;
  viewList: boolean;
}) {
  const readPage = (at: string | undefined) =>
    read(conversationsListMessages, {
      conversationId: conversation.id,
      order: "newest",
      cursor: at,
    });
  // A named message opens the page that holds it; one the backend cannot place in this
  // conversation leaves the newest page.
  const located =
    focus !== null && requested === undefined
      ? await call(conversationsLocateMessage, { messageId: focus }).catch(
          (error: unknown) => {
            if (error instanceof SermoError && error.status < 500) return null;
            throw error;
          },
        )
      : null;
  const cursor =
    located?.conversationId === conversation.id
      ? (located.cursor ?? undefined)
      : requested;
  const [
    { items: newestFirst, nextCursor },
    { user },
    reactionTypes,
    t,
    { notifications },
  ] = await Promise.all([
    readPage(cursor),
    getMember(),
    getReactionTypes(),
    getTranslations("conversations.conversation"),
    getCounters(),
  ]);
  // The backend lists from the newest end; the page reads from the oldest of its messages down.
  const messages = newestFirst.toReversed();
  // The viewer is among the authors: the row drawn for a message they are sending is theirs.
  const author = await authorsFor([
    ...messages.map((message) => message.author),
    ...(user ? [user] : []),
  ]);
  // One signature per member on the page: under their first message.
  const seen = new Set<number>();
  const firstOfAuthor = new Set(
    messages.flatMap((message) => {
      if (seen.has(message.author.id)) return [];
      seen.add(message.author.id);
      return [message.id];
    }),
  );
  const picker = canReact ? pickerTypes(reactionTypes, null) : [];
  const newest = messages.at(-1);
  return (
    <>
      {nextCursor && (
        <LoadMore
          href={`/conversations/${conversation.id}?cursor=${encodeURIComponent(nextCursor)}`}
          className="mb-3"
          icon={ChevronUp}
          scroll
        >
          {t("earlier")}
        </LoadMore>
      )}
      <ol className="divide-y divide-border overflow-hidden rounded-lg border bg-card">
        {messages.map((message) => (
          <li key={message.id}>
            <MessageItem
              message={message}
              author={author(message.author.id)}
              signed={firstOfAuthor.has(message.id)}
              viewerId={user?.id ?? null}
              picker={picker}
              reactionTypes={reactionTypes}
              viewList={viewList}
              canQuote={conversation.canReply}
            />
          </li>
        ))}
        {/* Only the newest page goes on: what is sent or arrives while it is open ends it. */}
        {!cursor && user && newest && (
          <LiveTail
            tailKey={tailKey(conversation.id)}
            drawn={{ id: newest.id, mark: newest.id }}
            as="li"
            poll={pollMessages.bind(null, conversation.id)}
            intervalMs={POLL_MS.messages}
            pendingRow={
              <PostFrame
                author={author(user.id)}
                createdAt={new Date().toISOString()}
                actions={null}
              >
                <PendingBody />
              </PostFrame>
            }
          />
        )}
      </ol>
      {cursor && (
        <LoadMore
          href={`/conversations/${conversation.id}`}
          className="mt-3"
          scroll
        >
          {t("newest")}
        </LoadMore>
      )}
      {/* Opening the conversation at any page records it as read; only the newest page scrolls. */}
      <ConversationSync
        key={messages.at(-1)?.id}
        id={conversation.id}
        mark={conversation.isUnread || notifications > 0}
        scroll={!cursor}
      />
    </>
  );
}
