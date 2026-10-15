"use server";

import { postsCreate } from "@sermo/core/contracts";
import {
  type PostRowContext,
  postRows,
} from "@/app/[locale]/(main)/threads/[id]/post-item";
import { call } from "@/lib/sermo/client";
import { formIds, requireIds } from "@/lib/sermo/ids";
import { attempt } from "@/lib/sermo/outcome";
import type { TailRow } from "@/lib/tail";

// Replies from the last page, which stays as it is: the answer is the post, drawn as the page draws
// it, for the end of the page (`lib/tail`). `context` is what the page knows of the thread. The
// form that cannot show it there uses `replyAction`.
export async function replyInPlace(
  threadId: number,
  context: PostRowContext,
  formData: FormData,
): Promise<{ error?: string; row?: TailRow }> {
  requireIds(threadId);
  const body = String(formData.get("body") ?? "");
  const attachmentIds = formIds(formData, "attachmentIds");
  const created = await attempt(`/threads/${threadId}`, () =>
    call(postsCreate, { threadId, body, attachmentIds }),
  );
  if (!created.ok) return { error: created.error };
  const [row] = await postRows([created.value], context);
  return { row };
}
