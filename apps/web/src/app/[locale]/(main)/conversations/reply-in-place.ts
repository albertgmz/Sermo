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
  // The message is saved. If drawing the answer fails the form must not keep the text, or a second
  // press would send it twice: it counts as sent, with no row, and the next poll finds the message.
  try {
    const [row] = await messageRows([sent.value]);
    return { row };
  } catch {
    return {};
  }
}
