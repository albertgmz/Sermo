import {
  conversationsGet,
  conversationsLocateMessage,
} from "@sermo/core/contracts";
import { LogOut, Mail } from "lucide-react";
import { notFound, redirect } from "next/navigation";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { ConversationWidgets } from "@/app/[locale]/(main)/conversations/[id]/conversation-widgets";
import { LeaveForm } from "@/app/[locale]/(main)/conversations/[id]/leave-form";
import {
  LockedBadge,
  ReplyArea,
} from "@/app/[locale]/(main)/conversations/[id]/locked-state";
import { MarkReadProvider } from "@/app/[locale]/(main)/conversations/[id]/mark-read-state";
import { MarkUnreadForm } from "@/app/[locale]/(main)/conversations/[id]/mark-unread-form";
import { conversationHref } from "@/app/[locale]/(main)/conversations/[id]/message-target";
import { messagesPage } from "@/app/[locale]/(main)/conversations/[id]/messages-page";
import {
  type Conversation,
  type MessagesContext,
  MessagesRegion,
  messagePages,
  messagesContext,
  readMessages,
  tailKey,
} from "@/app/[locale]/(main)/conversations/[id]/messages-region";
import { MessagesSkeleton } from "@/app/[locale]/(main)/conversations/[id]/messages-skeleton";
import { WidgetsSheet } from "@/app/[locale]/(main)/conversations/[id]/widgets-sheet";
import { BookmarkButton } from "@/components/forum/bookmark-button";
import { PageBreadcrumb } from "@/components/forum/page-breadcrumb";
import { PageSwitch } from "@/components/forum/page-switch";
import { pageAddress, pageParam } from "@/components/forum/page-window";
import { LoadingRegion } from "@/components/forum/skeletons";
import { UserLink } from "@/components/forum/user-link";
import { PageLayout } from "@/components/layout/page-layout";
import { bookmarkedAmong } from "@/lib/sermo/bookmarks";
import { call, read } from "@/lib/sermo/client";
import { SermoError } from "@/lib/sermo/errors";
import { parseId } from "@/lib/sermo/ids";
import { membersFor } from "@/lib/sermo/members";
import { getMember } from "@/lib/sermo/session";

type Members = Awaited<ReturnType<typeof membersFor>>;

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
  const [{ id: raw }, { page: pageParamValue, message }] = await Promise.all([
    params,
    searchParams,
  ]);
  const conversationId = conversationIdOf(raw);
  const [conversation, member, bookmarks, t] = await Promise.all([
    read(conversationsGet, { conversationId }),
    getMember(),
    bookmarkedAmong("conversation", [conversationId]),
    getTranslations("conversations.conversation"),
  ]);
  // A message's own address goes on to the address of the page that holds it; one the backend
  // cannot place in this conversation opens the first page.
  if (typeof message === "string" && pageParamValue === undefined)
    await goToMessage(conversation.id, parseId(message));
  const page = pageParam(pageParamValue);
  const people = await membersFor(
    conversation.participants.map((participant) => participant.user),
  );
  const context = messagesContext(conversation, member);

  return (
    <MarkReadProvider>
      <PageLayout
        className="pt-2"
        asideOnMobile="hidden"
        aside={
          <ConversationWidgets conversation={conversation} member={people} />
        }
      >
        <Header
          conversation={conversation}
          member={people}
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
            <Messages context={context} page={page} />
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
            canAttach={
              member.resolvedPermissions["conversation.attach"] !== false
            }
          />
        </section>
      </PageLayout>
    </MarkReadProvider>
  );
}

async function goToMessage(conversationId: number, messageId: number | null) {
  if (messageId === null) return;
  const located = await call(conversationsLocateMessage, { messageId }).catch(
    (error: unknown) => {
      if (error instanceof SermoError && error.status < 500) return null;
      throw error;
    },
  );
  if (located?.conversationId === conversationId)
    redirect(conversationHref(conversationId, messageId, located.page));
}

async function Messages({
  context,
  page,
}: {
  context: MessagesContext;
  page: number;
}) {
  const id = context.conversation.id;
  const list = await readMessages(id, page, read);
  // A page past the last one goes to the last one, as XenForo does.
  const pages = messagePages(list);
  if (page > pages) redirect(pageAddress(`/conversations/${id}`, {}, pages));
  return (
    <PageSwitch
      page={page}
      stamp={Date.now()}
      load={messagesPage.bind(null, id)}
    >
      <MessagesRegion context={context} page={page} list={list} />
    </PageSwitch>
  );
}
