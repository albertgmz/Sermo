import type { conversationsListMessages } from "@sermo/core/contracts";
import type * as z from "zod";
import { reportContent } from "@/app/[locale]/(main)/actions";
import { conversationHref } from "@/app/[locale]/(main)/conversations/[id]/message-target";
import { deleteMessageAction } from "@/app/[locale]/(main)/conversations/actions";
import { ContentActions } from "@/components/forum/content-actions";
import type { ReactionType } from "@/components/forum/reaction-button";
import { Reactions } from "@/components/forum/reactions";
import type { getReactionTypes } from "@/lib/sermo/reactions";

type Message = z.output<
  typeof conversationsListMessages.output
>["items"][number];

// The footer of a message in a conversation. Delete is the backend's word for the viewer
// (`canDelete`). There is no edit yet: the backend does not give a message's Markdown source.
export function MessageActions({
  message,
  viewerId,
  picker,
  reactionTypes,
}: {
  message: Message;
  viewerId: number | null;
  // What the picker offers; none when the viewer may not react.
  picker: ReactionType[];
  reactionTypes: Awaited<ReturnType<typeof getReactionTypes>>;
}) {
  const reactions = {
    target: "message" as const,
    id: message.id,
    reactions: message.reactions,
    authorId: message.author.id,
    viewerId,
    picker: message.state === "visible" ? picker : [],
    reactionTypes,
  };
  return (
    <ContentActions
      summary={<Reactions {...reactions} part="summary" />}
      react={<Reactions {...reactions} part="button" />}
      share={
        message.state === "deleted"
          ? undefined
          : conversationHref(message.conversationId, message.id)
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
    />
  );
}
