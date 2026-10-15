"use server";

import { conversationsReply } from "@sermo/core/contracts";
import { messageRows } from "@/app/[locale]/(main)/conversations/[id]/message-item";
import { call } from "@/lib/sermo/client";
import { formIds, requireIds } from "@/lib/sermo/ids";
import { attempt } from "@/lib/sermo/outcome";
import type { TailRow } from "@/lib/tail";

// Sends a message from the newest page, which stays as it is: the answer is the message, drawn as
// the page draws it, for the end of the conversation (`lib/tail`). The form that cannot show it
// there uses `replyAction`.
export async function replyInPlace(
  conversationId: number,
  formData: FormData,
): Promise<{ error?: string; row?: TailRow }> {
  requireIds(conversationId);
  const body = String(formData.get("body") ?? "");
  const attachmentIds = formIds(formData, "attachmentIds");
  const sent = await attempt(`/conversations/${conversationId}`, () =>
    call(conversationsReply, { conversationId, body, attachmentIds }),
  );
  if (!sent.ok) return { error: sent.error };
  const [row] = await messageRows([sent.value]);
  return { row };
}
