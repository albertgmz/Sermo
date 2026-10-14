import type { conversationsGet } from "@sermo/core/contracts";
import { useFormatter, useTranslations } from "next-intl";
import type * as z from "zod";
import { AddPeople } from "@/app/(main)/conversations/[id]/add-people";
import { MarkReadCard } from "@/app/(main)/conversations/[id]/mark-read-button";
import { RenameForm } from "@/app/(main)/conversations/[id]/rename-form";
import { MemberRow } from "@/components/forum/member-row";
import { SectionCard } from "@/components/forum/section-card";
import { UserLink } from "@/components/forum/user-link";
import type { membersFor } from "@/lib/sermo/members";

type Conversation = z.output<typeof conversationsGet.output>;
type Members = Awaited<ReturnType<typeof membersFor>>;

// The widgets beside the messages: information, participants, rename, mark as read. The page draws
// them in its aside and, below the desktop layout, inside the header's drawer.
export function ConversationWidgets({
  conversation,
  member,
}: {
  conversation: Conversation;
  member: Members;
}) {
  const t = useTranslations("conversations.conversation");
  const format = useFormatter();
  const active = conversation.participants
    .filter((participant) => participant.state === "active")
    .map((participant) => participant.user.id);
  return (
    <>
      <SectionCard title={t("info.title")} contentClassName="divide-y-0">
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 px-4 py-3 text-sm">
          <dt className="text-muted-foreground">{t("info.startedBy")}</dt>
          <dd className="min-w-0 truncate text-right">
            <UserLink user={member(conversation.starter.id)} />
          </dd>
          <dt className="text-muted-foreground">{t("info.startedOn")}</dt>
          <dd className="text-right">
            {format.dateTime(new Date(conversation.createdAt), {
              dateStyle: "medium",
            })}
          </dd>
          <dt className="text-muted-foreground">{t("info.messages")}</dt>
          <dd className="text-right">
            {format.number(conversation.messageCount)}
          </dd>
          <dt className="text-muted-foreground">{t("info.participants")}</dt>
          <dd className="text-right">
            {format.number(conversation.participantCount)}
          </dd>
        </dl>
      </SectionCard>
      <SectionCard title={t("participants")}>
        {conversation.participants.map((participant) => (
          <MemberRow
            key={participant.user.id}
            user={member(participant.user.id)}
            badgeLimit={1}
          >
            {participant.state === "left" && (
              <span className="shrink-0 text-xs text-muted-foreground">
                {t("left")}
              </span>
            )}
          </MemberRow>
        ))}
        {conversation.canInvite && (
          <AddPeople conversationId={conversation.id} exclude={active} />
        )}
      </SectionCard>
      {conversation.canRename && (
        <SectionCard title={t("rename.title")}>
          <RenameForm
            conversationId={conversation.id}
            title={conversation.title}
          />
        </SectionCard>
      )}
      {conversation.isUnread && (
        <MarkReadCard conversationId={conversation.id} />
      )}
    </>
  );
}
