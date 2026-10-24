import "server-only";

import { conversationsUpdateMessage } from "@sermo/core/contracts";
import { messageEditHref } from "@/app/[locale]/(main)/conversations/[id]/message-target";
import { call } from "@/lib/sermo/client";
import { formIds, requireIds } from "@/lib/sermo/ids";
import { attempt } from "@/lib/sermo/outcome";

// Saves an edited message: the one write of its edit page and of the edit made where it is read.
// A form without the file list leaves the files as they are.
export function saveMessageEdit(
  conversationId: number,
  messageId: number,
  formData: FormData,
) {
  requireIds(conversationId, messageId);
  return attempt(messageEditHref(conversationId, messageId), () =>
    call(conversationsUpdateMessage, {
      messageId,
      body: String(formData.get("body") ?? ""),
      attachmentIds: formData.has("attachments")
        ? formIds(formData, "attachmentIds")
        : undefined,
    }),
  );
}
