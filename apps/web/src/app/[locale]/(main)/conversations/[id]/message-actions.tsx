import type { conversationsListMessages } from "@sermo/core/contracts";
import type * as z from "zod";
import { reportContent } from "@/app/[locale]/(main)/actions";
import { conversationHref } from "@/app/[locale]/(main)/conversations/[id]/message-target";
import {
  deleteMessageAction,
  quoteMessageSource,
} from "@/app/[locale]/(main)/conversations/actions";
import { QUOTE_EVENT } from "@/app/[locale]/(main)/threads/[id]/quote";
import { ContentActions } from "@/components/forum/content-actions";
import { messageActionClass } from "@/components/forum/message-action";
import type { ReactionType } from "@/components/forum/reaction-button";
import { Reactions } from "@/components/forum/reactions";
import { ShareButton } from "@/components/forum/share-button";
import type { getReactionTypes } from "@/lib/sermo/reactions";

type Message = z.output<
  typeof conversationsListMessages.output
>["items"][number];

// The footer of a message in a conversation, laid out as a thread post's (XenForo draws a
// conversation message with the thread's message macros): share (a message has no header row to
// hold it, as a post has), report, edit and delete on the left; react and Reply on the right, and Reply quotes the message into the reply editor, as
// XenForo's. Edit (`canEdit`, which opens the edit page) and delete (`canDelete`) and report
// (`canReport`) are the backend's word for the viewer; Reply needs the right to reply here
// (`canQuote`) and a message everyone in the conversation sees.
export function MessageActions({
  message,
  viewerId,
  picker,
  reactionTypes,
  viewList,
  canQuote,
}: {
  message: Message;
  viewerId: number | null;
  // What the picker offers; none when the viewer may not react.
  picker: ReactionType[];
  reactionTypes: Awaited<ReturnType<typeof getReactionTypes>>;
  viewList?: boolean;
  canQuote: boolean;
}) {
  const reactions = {
    target: "message" as const,
    id: message.id,
    reactions: message.reactions,
    authorId: message.author.id,
    viewerId,
    picker: message.state === "visible" ? picker : [],
    reactionTypes,
    viewList,
  };
  return (
    <ContentActions
      summary={<Reactions {...reactions} part="summary" />}
      react={<Reactions {...reactions} part="button" />}
      quote={
        canQuote && message.state === "visible"
          ? {
              postId: message.id,
              event: QUOTE_EVENT,
              load: quoteMessageSource,
              reference: "convMessage",
              asReply: true,
            }
          : undefined
      }
      leading={
        message.state !== "deleted" && (
          <ShareButton
            href={conversationHref(message.conversationId, message.id)}
            className={messageActionClass}
          />
        )
      }
      edit={
        message.canEdit
          ? {
              href: `/conversations/${message.conversationId}/edit/${message.id}`,
            }
          : undefined
      }
      remove={
        message.canDelete && message.state !== "deleted"
          ? {
              action: deleteMessageAction.bind(
                null,
                message.conversationId,
                message.id,
              ),
            }
          : undefined
      }
      report={
        message.canReport &&
        viewerId !== null &&
        viewerId !== message.author.id &&
        message.state === "visible"
          ? {
              action: reportContent.bind(
                null,
                "conversation_message",
                message.id,
              ),
            }
          : undefined
      }
      layout="split"
    />
  );
}
