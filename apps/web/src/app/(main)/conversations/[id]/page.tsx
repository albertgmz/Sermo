import {
  conversationsGet,
  conversationsListMessages,
} from "@sermo/core/contracts";
import {
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
import { ConversationSync } from "@/app/(main)/conversations/[id]/conversation-sync";
import { LeaveForm } from "@/app/(main)/conversations/[id]/leave-form";
import { MessagesSkeleton } from "@/app/(main)/conversations/[id]/messages-skeleton";
import { ReplyForm } from "@/app/(main)/conversations/[id]/reply-form";
import { PostAttachments } from "@/app/(main)/threads/[id]/post-attachments";
import { HtmlContent } from "@/components/forum/html-content";
import { MessageRow } from "@/components/forum/message-row";
import { PageBreadcrumb } from "@/components/forum/page-breadcrumb";
import { Reactions } from "@/components/forum/reactions";
import { RelativeTime } from "@/components/forum/relative-time";
import { LoadingRegion } from "@/components/forum/skeletons";
import { UserAvatar } from "@/components/forum/user-avatar";
import { UserLink } from "@/components/forum/user-link";
import { PageLayout } from "@/components/layout/page-layout";
import { buttonVariants } from "@/components/ui/button";
import { read } from "@/lib/sermo/client";
import { parseId } from "@/lib/sermo/ids";
import { membersFor } from "@/lib/sermo/members";
import { getReactionTypes, pickerTypes } from "@/lib/sermo/reactions";
import { getMember } from "@/lib/sermo/session";
import { cn } from "@/lib/utils";

type Conversation = z.output<typeof conversationsGet.output>;
type Members = Awaited<ReturnType<typeof membersFor>>;

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
    <p className="mb-2 flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
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
  const [{ id: raw }, { cursor }] = await Promise.all([params, searchParams]);
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
          <MessageNote icon={Lock}>{t("cannotReply")}</MessageNote>
        )}
      </section>
    </PageLayout>
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
      }),
      getMember(),
      getReactionTypes(),
      getTranslations("conversations.conversation"),
    ]);
  // The backend lists from the newest end; the page reads from the oldest of its messages down.
  const messages = newestFirst.toReversed();
  const member = await membersFor(messages.map((message) => message.author));
  const picker = canReact ? pickerTypes(reactionTypes) : [];
  const link = cn(buttonVariants({ variant: "outline" }), "h-10 w-full");

  return (
    <>
      {nextCursor && (
        <Link
          href={`/conversations/${conversation.id}?cursor=${encodeURIComponent(nextCursor)}`}
          className={cn(link, "mb-3")}
        >
          <ChevronUp />
          {t("earlier")}
        </Link>
      )}
      <ol className="divide-y divide-border overflow-hidden rounded-lg border bg-card">
        {messages.map((message) => (
          <li key={message.id}>
            <MessageRow
              id={`message-${message.id}`}
              author={member(message.author.id)}
              time={<RelativeTime date={message.createdAt} />}
              actions={
                <Reactions
                  target="message"
                  id={message.id}
                  reactions={message.reactions}
                  authorId={message.author.id}
                  viewerId={user?.id ?? null}
                  picker={message.state === "visible" ? picker : []}
                  reactionTypes={reactionTypes}
                />
              }
            >
              <div className="max-w-3xl">
                {message.state === "moderated" && (
                  <MessageNote icon={Hourglass}>
                    {t("awaitingApproval")}
                  </MessageNote>
                )}
                {message.state === "deleted" && (
                  <MessageNote icon={Trash2}>{t("deleted")}</MessageNote>
                )}
                <HtmlContent>{message.bodyHtml}</HtmlContent>
                <PostAttachments attachments={message.attachments} />
              </div>
            </MessageRow>
          </li>
        ))}
      </ol>
      {cursor ? (
        <Link
          href={`/conversations/${conversation.id}`}
          className={cn(link, "mt-3")}
        >
          <ChevronDown />
          {t("newest")}
        </Link>
      ) : (
        <ConversationSync
          key={messages.at(-1)?.id}
          id={conversation.id}
          unread={conversation.isUnread}
        />
      )}
    </>
  );
}
