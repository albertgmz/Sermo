import type { conversationsListMessages } from "@sermo/core/contracts";
import { Hourglass, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import type * as z from "zod";
import { MessageActions } from "@/app/[locale]/(main)/conversations/[id]/message-actions";
import { PostAttachments } from "@/app/[locale]/(main)/threads/[id]/post-attachments";
import { EditedMark } from "@/components/forum/edited-mark";
import { HtmlContent } from "@/components/forum/html-content";
import { PostFrame, PostNote } from "@/components/forum/post-frame";
import type { ReactionType } from "@/components/forum/reaction-button";
import { inlineAttachmentIds } from "@/lib/attachment-tags";
import { authorsFor } from "@/lib/sermo/members";
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
  signed,
  viewerId,
  picker,
  reactionTypes,
}: {
  message: ApiMessage;
  author: AuthorView;
  // Whether the author's signature closes the message: their first one on the page.
  signed: boolean;
  viewerId: number | null;
  picker: ReactionType[];
  reactionTypes: Awaited<ReturnType<typeof getReactionTypes>>;
}) {
  const t = useTranslations("conversations.conversation");
  return (
    <PostFrame
      id={`message-${message.id}`}
      author={author}
      createdAt={message.createdAt}
      edited={message.editedAt && <EditedMark date={message.editedAt} />}
      signed={signed}
      actions={
        <MessageActions
          message={message}
          viewerId={viewerId}
          picker={picker}
          reactionTypes={reactionTypes}
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
  const [{ user, permissions }, reactionTypes] = await Promise.all([
    getViewer(),
    getReactionTypes(),
  ]);
  const author = await authorsFor(messages.map((message) => message.author));
  const picker = permissions.canReact ? pickerTypes(reactionTypes) : [];
  return messages.map((message) => ({
    key: `message-${message.id}`,
    id: message.id,
    mark: message.id,
    node: (
      <MessageItem
        message={message}
        author={author(message.author.id)}
        signed={false}
        viewerId={user?.id ?? null}
        picker={picker}
        reactionTypes={reactionTypes}
      />
    ),
  }));
}
