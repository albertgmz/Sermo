import type { conversationsListMessages } from "@sermo/core/contracts";
import { Hourglass, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import type * as z from "zod";
import { MessageActions } from "@/app/[locale]/(main)/conversations/[id]/message-actions";
import { PostBody } from "@/app/[locale]/(main)/threads/[id]/post-body";
import {
  EditablePostBody,
  EditedStamp,
  PostEditScope,
} from "@/app/[locale]/(main)/threads/[id]/post-edit-scope";
import { EditedMark } from "@/components/forum/edited-mark";
import { PostFrame, PostNote } from "@/components/forum/post-frame";
import type { ReactionType } from "@/components/forum/reaction-button";
import { quotable } from "@/components/forum/selection-bb";
import { authorsFor } from "@/lib/sermo/members";
import { getReactionTypes, pickerTypes } from "@/lib/sermo/reactions";
import { getViewer } from "@/lib/sermo/session";
import type { AuthorView } from "@/lib/sermo/views";
import type { TailRow } from "@/lib/tail";

export type ApiMessage = z.output<
  typeof conversationsListMessages.output
>["items"][number];

// One message of a conversation as it is drawn in the list, on the page and in what is added to it
// while the page is open: a thread's post (`PostItem`), drawn with the same frame, body, footer and
// quick edit. Only the rules of a private conversation differ: no share, no bookmark and no post
// number in its header row, and what it links to stays inside the conversation.
export function MessageItem({
  message,
  author,
  signed,
  viewerId,
  picker,
  reactionTypes,
  viewList,
  canQuote,
}: {
  message: ApiMessage;
  author: AuthorView;
  // Whether the author's signature closes the message: their first one on the page.
  signed: boolean;
  viewerId: number | null;
  picker: ReactionType[];
  reactionTypes: Awaited<ReturnType<typeof getReactionTypes>>;
  viewList?: boolean;
  // Whether the viewer may reply here, so a message's Quote has an editor to quote it into.
  canQuote: boolean;
}) {
  const t = useTranslations("conversations.conversation");
  // Its Edit opens the editor in place of the text (a deleted message's goes to the edit page).
  const inPlace = message.canEdit && message.state !== "deleted";
  const edited = message.editedAt && <EditedMark date={message.editedAt} />;
  // What a selection inside the text needs to quote only that part (`SelectionQuote`).
  const quote =
    canQuote && message.state === "visible"
      ? quotable("convMessage", message.id, message.author)
      : undefined;
  const body = (
    <PostBody
      post={message}
      type="conversation_message"
      className="md:mt-1"
      quote={quote}
    />
  );
  const frame = (
    <PostFrame
      id={`message-${message.id}`}
      author={author}
      createdAt={message.createdAt}
      edited={inPlace ? <EditedStamp>{edited}</EditedStamp> : edited}
      signed={signed}
      actions={
        <MessageActions
          message={message}
          viewerId={viewerId}
          picker={picker}
          reactionTypes={reactionTypes}
          viewList={viewList}
          canQuote={canQuote}
        />
      }
    >
      {message.state === "moderated" && (
        <PostNote icon={Hourglass}>{t("awaitingApproval")}</PostNote>
      )}
      {message.state === "deleted" && (
        <PostNote icon={Trash2}>{t("deleted")}</PostNote>
      )}
      {inPlace ? (
        <EditablePostBody canQuote={quote !== undefined}>
          {body}
        </EditablePostBody>
      ) : (
        body
      )}
    </PostFrame>
  );
  return inPlace ? (
    <PostEditScope
      target={{
        kind: "message",
        conversationId: message.conversationId,
        messageId: message.id,
      }}
    >
      {frame}
    </PostEditScope>
  ) : (
    frame
  );
}

// Messages that came after the page was drawn, drawn the way the page draws them. A signature
// stays under the author's first message on the page, so none is drawn here. Their Reply is
// drawn: they come to the newest page, which has the reply editor unless the viewer may not reply
// there (then Reply quotes into nothing until the page is drawn again).
export async function messageRows(messages: ApiMessage[]): Promise<TailRow[]> {
  if (messages.length === 0) return [];
  const [{ user, permissions, resolvedPermissions }, reactionTypes] =
    await Promise.all([getViewer(), getReactionTypes()]);
  const author = await authorsFor(messages.map((message) => message.author));
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
        signed={false}
        viewerId={user?.id ?? null}
        picker={picker}
        reactionTypes={reactionTypes}
        viewList={resolvedPermissions["reaction.viewList"] !== false}
        canQuote
      />
    ),
  }));
}
