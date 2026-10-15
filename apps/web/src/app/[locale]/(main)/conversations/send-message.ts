import "server-only";

import { conversationsReply } from "@sermo/core/contracts";
import { call } from "@/lib/sermo/client";
import { formIds, requireIds } from "@/lib/sermo/ids";
import { attempt } from "@/lib/sermo/outcome";

// Adds the message of a reply form to a conversation: the one write both reply actions make, the
// one that ends in a redirect and the one that answers with the drawn message.
export function sendMessage(conversationId: number, formData: FormData) {
  requireIds(conversationId);
  const body = String(formData.get("body") ?? "");
  const attachmentIds = formIds(formData, "attachmentIds");
  return attempt(`/conversations/${conversationId}`, () =>
    call(conversationsReply, { conversationId, body, attachmentIds }),
  );
}
