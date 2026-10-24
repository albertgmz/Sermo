import type { conversationsListMessages } from "@sermo/core/contracts";
import { useTranslations } from "next-intl";
import type * as z from "zod";
import { reportContent } from "@/app/[locale]/(main)/actions";
import { messageEditHref } from "@/app/[locale]/(main)/conversations/[id]/message-target";
import {
  deleteMessageAction,
  quoteMessageSource,
} from "@/app/[locale]/(main)/conversations/actions";
import { QUOTE_EVENT } from "@/app/[locale]/(main)/threads/[id]/quote";
import { ContentActions } from "@/components/forum/content-actions";
import { deleteMode } from "@/components/forum/delete-mode";
import { DeletionTools } from "@/components/forum/deletion-notice";
import type { ReactionType } from "@/components/forum/reaction-button";
import { Reactions } from "@/components/forum/reactions";
import type { getReactionTypes } from "@/lib/sermo/reactions";

type Message = z.output<
  typeof conversationsListMessages.output
>["items"][number];

// The footer of a message in a conversation: a thread post's (`PostActions`), as XenForo draws a
// conversation message with the thread's message macros. Report, edit (in place, as a post's) and
// delete on the left; react, "+ Quote" and Reply on the right; who reacted under it. A private
// message has no share. Edit, delete and report are the backend's word for the viewer (`canEdit`,
// `canDelete`, `canHardDelete`, `canReport`); quoting and Reply need the right to reply here
// (`canQuote`), and quoting a message everyone in the conversation sees; a deleted message is not
// answered. A deleted message's delete sits on its deletion notice instead (`part`: "tools" there,
// "footer" for the rest).
export function MessageActions({
  message,
  viewerId,
  picker,
  reactionTypes,
  viewList,
  canQuote,
  part,
}: {
  message: Message;
  viewerId: number | null;
  // What the picker offers; none when the viewer may not react.
  picker: ReactionType[];
  reactionTypes: Awaited<ReturnType<typeof getReactionTypes>>;
  viewList?: boolean;
  canQuote: boolean;
  // Only the delete ("tools"), or all but it ("footer"); all when left out.
  part?: "tools" | "footer";
}) {
  const actions = useTranslations("forum.contentActions");
  const removal = deleteMode(message, false);
  const remove = removal.show
    ? {
        action: deleteMessageAction.bind(
          null,
          message.conversationId,
          message.id,
        ),
        permanent: removal.permanent,
        warning: actions("deleteWarning"),
        permanentHint: actions("hardDeleteMessageWarning"),
      }
    : undefined;
  if (part === "tools") return <DeletionTools remove={remove} />;
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
      layout="split"
      summary={<Reactions {...reactions} part="summary" />}
      react={<Reactions {...reactions} part="button" />}
      quote={
        canQuote && message.state === "visible"
          ? {
              postId: message.id,
              event: QUOTE_EVENT,
              load: quoteMessageSource,
              reference: "convMessage",
            }
          : undefined
      }
      reply={
        canQuote && message.state !== "deleted" ? { href: "#reply" } : undefined
      }
      edit={
        message.canEdit
          ? { href: messageEditHref(message.conversationId, message.id) }
          : undefined
      }
      remove={part === "footer" ? undefined : remove}
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
    />
  );
}
