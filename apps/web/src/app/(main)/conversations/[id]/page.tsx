import {
  conversationsGet,
  conversationsListMessages,
} from "@sermo/core/contracts";
import { ChevronUp, Hourglass, Lock, LogOut, Trash2 } from "lucide-react";
import { notFound } from "next/navigation";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import type * as z from "zod";
import { ConversationSync } from "@/app/(main)/conversations/[id]/conversation-sync";
import { LeaveForm } from "@/app/(main)/conversations/[id]/leave-form";
import { MessagesSkeleton } from "@/app/(main)/conversations/[id]/messages-skeleton";
import { ReplyForm } from "@/app/(main)/conversations/[id]/reply-form";
import { PostAttachments } from "@/app/(main)/threads/[id]/post-attachments";
import { HtmlContent } from "@/components/forum/html-content";
import { LoadMore } from "@/components/forum/load-more";
import { PageBreadcrumb } from "@/components/forum/page-breadcrumb";
import { PostFrame, PostNote } from "@/components/forum/post-frame";
import { Reactions } from "@/components/forum/reactions";
import { LoadingRegion } from "@/components/forum/skeletons";
import { UserAvatar } from "@/components/forum/user-avatar";
import { UserLink } from "@/components/forum/user-link";
import { PageLayout } from "@/components/layout/page-layout";
import { read } from "@/lib/sermo/client";
import { parseId } from "@/lib/sermo/ids";
import { pageHolding } from "@/lib/sermo/locate";
import { authorsFor, membersFor } from "@/lib/sermo/members";
import { getReactionTypes, pickerTypes } from "@/lib/sermo/reactions";
import { getMember } from "@/lib/sermo/session";

type Conversation = z.output<typeof conversationsGet.output>;
type Members = Awaited<ReturnType<typeof membersFor>>;

function conversationIdOf(raw: string) {
  const id = parseId(raw);
  if (id === null) notFound();
  return id;
}

function Header({
  conversation,
  member,
}: {
  conversation: Conversation;
  member: Members;
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
        <h1 className="min-w-0 flex-1 text-2xl font-semibold tracking-tight [overflow-wrap:anywhere]">
          {conversation.title}
        </h1>
        <LeaveForm
          conversationId={conversation.id}
          label={t("leave")}
          ariaLabel={t("aria.leave")}
        >
          <LogOut />
        </LeaveForm>
      </div>
      {/* On a wide screen the participants have a card of their own beside the messages. */}
      <p className="text-sm text-muted-foreground [overflow-wrap:anywhere] lg:hidden">
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

function Participants({
  conversation,
  member,
}: {
  conversation: Conversation;
  member: Members;
}) {
  const t = useTranslations("conversations.conversation");
  return (
    <section className="rounded-lg border bg-card">
      <h2 className="border-b px-4 py-3 text-sm font-semibold">
        {t("participants")}
      </h2>
      <ul className="divide-y">
        {conversation.participants.map((participant) => (
          <li
            key={participant.user.id}
            className="flex min-h-12 items-center gap-3 px-4 py-2 text-sm"
          >
            <UserAvatar user={member(participant.user.id)} size="md" />
            <span className="min-w-0 flex-1 truncate">
              <UserLink user={member(participant.user.id)} />
            </span>
            {participant.state === "left" && (
              <span className="shrink-0 text-xs text-muted-foreground">
                {t("left")}
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

export default async function ConversationPage({
  params,
  searchParams,
}: PageProps<"/conversations/[id]">) {
  const [{ id: raw }, { cursor, message }] = await Promise.all([
    params,
    searchParams,
  ]);
  const conversationId = conversationIdOf(raw);
  const [conversation, { permissions }, t] = await Promise.all([
    read(conversationsGet, { conversationId }),
    getMember(),
    getTranslations("conversations.conversation"),
  ]);
  const member = await membersFor(
    conversation.participants.map((participant) => participant.user),
  );

  return (
    <PageLayout
      className="pt-2"
      asideOnMobile="hidden"
      aside={<Participants conversation={conversation} member={member} />}
    >
      <Header conversation={conversation} member={member} />
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
            canReact={permissions.canReact}
          />
        </Suspense>
      </div>

      <section className="mt-4">
        {conversation.canReply ? (
          <ReplyForm
            conversationId={conversation.id}
            placeholder={t("placeholder")}
            submitLabel={t("submit")}
          />
        ) : (
          <PostNote icon={Lock}>{t("cannotReply")}</PostNote>
        )}
      </section>
    </PageLayout>
  );
}

async function Messages({
  conversation,
  cursor: requested,
  focus,
  canReact,
}: {
  conversation: Conversation;
  cursor: string | undefined;
  // A message an address names, which the page of messages that holds it is opened at.
  focus: number | null;
  canReact: boolean;
}) {
  const readPage = (at: string | undefined) =>
    read(conversationsListMessages, {
      conversationId: conversation.id,
      order: "newest",
      cursor: at,
    });
  const found =
    focus !== null && requested === undefined
      ? await pageHolding(readPage, (message) => message.id === focus)
      : null;
  const cursor = found ? found.cursor : requested;
  const [{ items: newestFirst, nextCursor }, { user }, reactionTypes, t] =
    await Promise.all([
      found ? Promise.resolve(found.page) : readPage(cursor),
      getMember(),
      getReactionTypes(),
      getTranslations("conversations.conversation"),
    ]);
  // The backend lists from the newest end; the page reads from the oldest of its messages down.
  const messages = newestFirst.toReversed();
  const author = await authorsFor(messages.map((message) => message.author));
  // One signature per member on the page: under their first message.
  const seen = new Set<number>();
  const firstOfAuthor = new Set(
    messages.flatMap((message) => {
      if (seen.has(message.author.id)) return [];
      seen.add(message.author.id);
      return [message.id];
    }),
  );
  const picker = canReact ? pickerTypes(reactionTypes) : [];

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
            <PostFrame
              id={`message-${message.id}`}
              author={author(message.author.id)}
              createdAt={message.createdAt}
              signed={firstOfAuthor.has(message.id)}
              actions={
                <Reactions
                  target="message"
                  id={message.id}
                  reactions={message.reactions}
                  authorId={message.author.id}
                  viewerId={user?.id ?? null}
                  picker={message.state === "visible" ? picker : []}
                  reactionTypes={reactionTypes}
                  className="mr-auto"
                />
              }
            >
              {message.state === "moderated" && (
                <PostNote icon={Hourglass}>{t("awaitingApproval")}</PostNote>
              )}
              {message.state === "deleted" && (
                <PostNote icon={Trash2}>{t("deleted")}</PostNote>
              )}
              <HtmlContent className="md:mt-1">{message.bodyHtml}</HtmlContent>
              <PostAttachments attachments={message.attachments} />
            </PostFrame>
          </li>
        ))}
      </ol>
      {cursor ? (
        <LoadMore
          href={`/conversations/${conversation.id}`}
          className="mt-3"
          scroll
        >
          {t("newest")}
        </LoadMore>
      ) : (
        <ConversationSync key={messages.at(-1)?.id} id={conversation.id} />
      )}
    </>
  );
}
