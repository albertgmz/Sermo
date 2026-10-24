import "server-only";

import { conversationsGetMessage } from "@sermo/core/contracts";
import {
  attachedFiles,
  type PostEditFields,
} from "@/app/[locale]/(main)/threads/[id]/edit/[postId]/edit-data";
import type { call } from "@/lib/sermo/client";

// The message and what its edit forms (the edit page, the editor in the conversation) open with,
// as a post's: its BB code and its files, with no thread title. The backend gives the source only
// to a viewer who may edit the message; anyone else, a non-participant first, gets not found. Null
// when the message is not one of that conversation's. `canAttach` is the viewer's
// `conversation.attach`: files a message has stay listed where new ones may not be added.
export async function loadMessageEdit(
  ask: typeof call,
  conversationId: number,
  messageId: number,
  canAttach: boolean,
) {
  const message = await ask(conversationsGetMessage, { messageId });
  if (message.conversationId !== conversationId) return null;
  const attached = attachedFiles(message.attachments);
  const fields: PostEditFields = {
    source: message.bodySource,
    files: canAttach || attached.length > 0 ? {} : null,
    attached,
    thread: null,
  };
  return { message, fields };
}
