"use server";

import { messageRows } from "@/app/[locale]/(main)/conversations/[id]/message-item";
import { sendMessage } from "@/app/[locale]/(main)/conversations/send-message";
import type { TailRow } from "@/lib/tail";

// Sends a message from the newest page, which stays as it is: the answer is the message, drawn as
// the page draws it, for the end of the conversation (`lib/tail`). The form that cannot show it
// there uses `replyAction`.
export async function replyInPlace(
  conversationId: number,
  formData: FormData,
): Promise<{ error?: string; row?: TailRow }> {
  const sent = await sendMessage(conversationId, formData);
  if (!sent.ok) return { error: sent.error };
  const [row] = await messageRows([sent.value]);
  return { row };
}
