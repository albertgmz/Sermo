import type { conversationsListMessages } from "@sermo/core/contracts";
import { Hourglass, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import type * as z from "zod";
import { MessageActions } from "@/app/[locale]/(main)/conversations/[id]/message-actions";
import { PostAttachments } from "@/app/[locale]/(main)/threads/[id]/post-attachments";
import { EditedMark } from "@/components/forum/edited-mark";
import { HtmlContent } from "@/components/forum/html-content";
import { memberActionsOf } from "@/components/forum/member-actions";
import { PostFrame, PostNote } from "@/components/forum/post-frame";
import type { ReactionType } from "@/components/forum/reaction-button";
import { inlineAttachmentIds } from "@/lib/attachment-tags";
import {
  authorsFor,
  type MemberRelation,
  relationsFor,
} from "@/lib/sermo/members";
import { getReactionTypes, pickerTypes } from "@/lib/sermo/reactions";
import { getViewer } from "@/lib/sermo/session";
import type { AuthorView } from "@/lib/sermo/views";
import type { TailRow } from "@/lib/tail";

export type ApiMessage = z.output<
  typeof conversationsListMessages.output
>["items"][number];

// One message of a conversation as it is drawn in the list, on the page and in what is added to it
// while the page is open.
export function MessageItem({
  message,
  author,
  relation,
  signed,
  viewerId,
  picker,
  reactionTypes,
  viewList,
}: {
  message: ApiMessage;
  author: AuthorView;
  // What the viewer may do about the author (follow, message), read once for the page.
  relation: MemberRelation | null;
  // Whether the author's signature closes the message: their first one on the page.
  signed: boolean;
  viewerId: number | null;
  picker: ReactionType[];
  reactionTypes: Awaited<ReturnType<typeof getReactionTypes>>;
  viewList?: boolean;
}) {
  const t = useTranslations("conversations.conversation");
  return (
    <PostFrame
      id={`message-${message.id}`}
      author={author}
      createdAt={message.createdAt}
      postbitActions={memberActionsOf(author.member, relation)}
      edited={message.editedAt && <EditedMark date={message.editedAt} />}
      signed={signed}
      actions={
        <MessageActions
          message={message}
          viewerId={viewerId}
          picker={picker}
          reactionTypes={reactionTypes}
          viewList={viewList}
        />
      }
    >
      {message.state === "moderated" && (
        <PostNote icon={Hourglass}>{t("awaitingApproval")}</PostNote>
      )}
      {message.state === "deleted" && (
        <PostNote icon={Trash2}>{t("deleted")}</PostNote>
      )}
      <HtmlContent
        className="md:mt-1"
        content={{ type: "conversation_message", id: message.id }}
        attachments={message.attachments}
      >
        {message.bodyHtml}
      </HtmlContent>
      <PostAttachments
        attachments={message.attachments}
        inline={inlineAttachmentIds(message.bodyHtml, message.attachments)}
      />
    </PostFrame>
  );
}

// Messages that came after the page was drawn, drawn the way the page draws them. A signature
// stays under the author's first message on the page, so none is drawn here.
export async function messageRows(messages: ApiMessage[]): Promise<TailRow[]> {
  if (messages.length === 0) return [];
  const [{ user, permissions, resolvedPermissions }, reactionTypes] =
    await Promise.all([getViewer(), getReactionTypes()]);
  const authors = messages.map((message) => message.author);
  const [author, relation] = await Promise.all([
    authorsFor(authors),
    relationsFor(
      user?.id ?? null,
      authors.map(({ id }) => id),
    ),
  ]);
  const picker =
    permissions.canReact && resolvedPermissions["conversation.react"] !== false
      ? pickerTypes(reactionTypes, null)
      : [];
  return messages.map((message) => ({
    key: `message-${message.id}`,
    id: message.id,
    mark: message.id,
    node: (
      <MessageItem
        message={message}
        author={author(message.author.id)}
        relation={relation(message.author.id)}
        signed={false}
        viewerId={user?.id ?? null}
        picker={picker}
        reactionTypes={reactionTypes}
        viewList={resolvedPermissions["reaction.viewList"] !== false}
      />
    ),
  }));
}
