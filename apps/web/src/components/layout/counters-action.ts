"use server";

import { authCounters } from "@sermo/core/contracts";
import { callForPoll } from "@/lib/sermo/client";
import { type PollStop, pollQuietly } from "@/lib/sermo/poll-actions";

// The unread counts of the header, read as the visitor, from the same read the page draws them
// with (one request).
export async function readCounters(): Promise<
  { conversations: number; notifications: number } | PollStop
> {
  return pollQuietly(async () => {
    const { conversations, notifications } = await callForPoll(
      authCounters,
      {},
    );
    return { conversations, notifications };
  });
}
