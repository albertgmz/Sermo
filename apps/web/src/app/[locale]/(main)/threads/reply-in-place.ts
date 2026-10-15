"use server";

import { postRows } from "@/app/[locale]/(main)/threads/[id]/post-item";
import { sendReply } from "@/app/[locale]/(main)/threads/send-reply";
import type { TailRow } from "@/lib/tail";

// Replies from the last page, which stays as it is: the answer is the post, drawn as the page draws
// it, for the end of the page (`lib/tail`). The form that cannot show it there uses
// `replyAction`.
export async function replyInPlace(
  threadId: number,
  formData: FormData,
): Promise<{ error?: string; row?: TailRow }> {
  const created = await sendReply(threadId, formData);
  if (!created.ok) return { error: created.error };
  // The reply is saved. If drawing the answer fails the form must not keep the text, or a second
  // press would post it twice: it counts as sent, with no row, and the next poll finds the post.
  try {
    const [row] = await postRows([created.value]);
    return { row };
  } catch {
    return {};
  }
}
