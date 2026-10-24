import type { conversationsGet } from "@sermo/core/contracts";
import { useFormatter, useTranslations } from "next-intl";
import type * as z from "zod";
import { AddPeople } from "@/app/[locale]/(main)/conversations/[id]/add-people";
import { MarkReadCard } from "@/app/[locale]/(main)/conversations/[id]/mark-read-button";
import { Fact, FactList } from "@/components/forum/fact-list";
import { MemberRow } from "@/components/forum/member-row";
import { SectionCard } from "@/components/forum/section-card";
import { UserLink } from "@/components/forum/user-link";
import type { membersFor } from "@/lib/sermo/members";

type Conversation = z.output<typeof conversationsGet.output>;
type Members = Awaited<ReturnType<typeof membersFor>>;

// The widgets beside the messages: information, participants, mark as read (renaming and locking are
// in the header's Edit dialog). The page draws them in its aside and, below the desktop layout,
// inside the header's drawer.
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
      <SectionCard title={t("info.title")}>
        <FactList>
          <Fact label={t("info.startedBy")}>
            <UserLink user={member(conversation.starter.id)} />
          </Fact>
          <Fact label={t("info.startedOn")}>
            {format.dateTime(new Date(conversation.createdAt), {
              dateStyle: "medium",
            })}
          </Fact>
          <Fact label={t("info.messages")}>
            {format.number(conversation.messageCount)}
          </Fact>
          <Fact label={t("info.participants")}>
            {format.number(conversation.participantCount)}
          </Fact>
        </FactList>
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
      {conversation.isUnread && (
        <MarkReadCard conversationId={conversation.id} />
      )}
    </>
  );
}
