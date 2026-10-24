"use server";

import { loadMessageEdit } from "@/app/[locale]/(main)/conversations/[id]/edit/[messageId]/edit-data";
import { conversationHref } from "@/app/[locale]/(main)/conversations/[id]/message-target";
import { saveMessageEdit } from "@/app/[locale]/(main)/conversations/save-message-edit";
import type { PostEditFields } from "@/app/[locale]/(main)/threads/[id]/edit/[postId]/edit-data";
import { PostBody } from "@/app/[locale]/(main)/threads/[id]/post-body";
import { EditedMark } from "@/components/forum/edited-mark";
import { quotable } from "@/components/forum/selection-bb";
import { call } from "@/lib/sermo/client";
import { requireIds } from "@/lib/sermo/ids";
import { attempt } from "@/lib/sermo/outcome";
import { getViewer } from "@/lib/sermo/session";

// The edit of a conversation message made where it is read, as a thread post's
// (`threads/edit-in-place`): what the editor opens with, and the save, which answers with the
// message as drawn now instead of a redirect. The edit page stays for "More options" and for
// browsers without JavaScript; the write is its own (`saveMessageEdit`). Only a participant who
// may edit the message gets anything: the backend answers anyone else not found.

type Refused = { error: string };

// What the message's editor opens with. A message the viewer may not edit (or cannot see), or
// that is not one of the conversation's, opens nothing.
export async function messageEditorAction(
  conversationId: number,
  messageId: number,
): Promise<{ fields: PostEditFields } | Refused> {
  requireIds(conversationId, messageId);
  const loaded = await attempt(conversationHref(conversationId), async () => {
    const { resolvedPermissions } = await getViewer();
    return loadMessageEdit(
      call,
      conversationId,
      messageId,
      resolvedPermissions["conversation.attach"] !== false,
    );
  });
  if (!loaded.ok) return { error: loaded.error };
  if (!loaded.value?.message.canEdit) return { error: "" };
  return { fields: loaded.value.fields };
}

// Saves the message's editor: the text and files as drawn now, and when it was edited.
export async function saveMessageInPlace(
  conversationId: number,
  messageId: number,
  // The page drew the message quotable by selection; only the quoting itself
  // (`quoteMessageSource`) reads the message, as the viewer may.
  canQuote: boolean,
  formData: FormData,
): Promise<{ body: React.ReactNode; edited: React.ReactNode } | Refused> {
  const saved = await saveMessageEdit(conversationId, messageId, formData);
  if (!saved.ok) return { error: saved.error };
  const message = saved.value;
  return {
    body: (
      <PostBody
        post={message}
        type="conversation_message"
        className="md:mt-1"
        quote={
          canQuote && message.state === "visible"
            ? quotable("convMessage", message.id, message.author)
            : undefined
        }
      />
    ),
    edited: message.editedAt && <EditedMark date={message.editedAt} />,
  };
}
