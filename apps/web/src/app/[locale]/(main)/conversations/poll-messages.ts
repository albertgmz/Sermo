"use server";

import { conversationsListMessages } from "@sermo/core/contracts";
import { messageRows } from "@/app/[locale]/(main)/conversations/[id]/message-item";
import { markRead } from "@/app/[locale]/(main)/conversations/actions";
import { callForPoll } from "@/lib/sermo/client";
import { requireIds } from "@/lib/sermo/ids";
import { pollQuietly } from "@/lib/sermo/poll-actions";
import type { TailPoll } from "@/lib/tail";

// The messages after the newest one the page holds (`held.mark` is its id), drawn as the page
// draws them: usually none, from one index read and no more. Messages that arrive are on the
// visitor's screen, so the conversation is marked read up to them.
export async function pollMessages(
  conversationId: number,
  held: { id: number; mark: number },
): Promise<TailPoll> {
  requireIds(conversationId, held.mark);
  return pollQuietly<TailPoll>(async () => {
    const { items } = await callForPoll(conversationsListMessages, {
      conversationId,
      afterMessageId: held.mark,
    });
    if (items.length === 0) return { rows: [] };
    await markRead(conversationId);
    return { rows: await messageRows(items) };
  });
}
