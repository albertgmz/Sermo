"use server";

import { postsList } from "@sermo/core/contracts";
import { postRows } from "@/app/[locale]/(main)/threads/[id]/post-item";
import { markRead } from "@/app/[locale]/(main)/threads/actions";
import { callForPoll } from "@/lib/sermo/client";
import { requireIds } from "@/lib/sermo/ids";
import { pollQuietly } from "@/lib/sermo/poll-actions";
import type { TailPoll } from "@/lib/tail";

// The replies after the newest post the page holds (`held.mark` is its position, `held.id` its
// id), drawn as the page draws them: usually none, from one index read. The answer says which
// post stands at that position now; when it is not the one the page holds (a merge moved posts
// under it, the post was removed) the thread has to be drawn again, and the replies are not used.
// Replies that arrive are on the visitor's screen, so the thread is marked read up to the newest
// of them, which is also where the next poll starts. That comes after they are drawn: drawn after,
// they would read as already read and lose their "New" badge. What the browser sends is only
// where to start; how the rows are drawn is worked out here.
export async function pollPosts(
  threadId: number,
  held: { id: number; mark: number },
): Promise<TailPoll> {
  requireIds(threadId, held.id);
  return pollQuietly<TailPoll>(async () => {
    const list = await callForPoll(postsList, {
      threadId,
      afterPosition: held.mark,
    });
    if (list.afterPostId !== held.id) return { reload: true };
    if (list.items.length === 0) return { rows: [] };
    const rows = await postRows(list.items);
    await markRead(threadId, list.items[list.items.length - 1].position);
    return { rows };
  });
}
