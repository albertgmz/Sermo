"use server";

import { postsCreate, threadsMarkRead } from "@sermo/core/contracts";
import { redirect } from "next/navigation";
import { threadHref } from "@/app/(main)/threads/[id]/pages";
import { call } from "@/lib/sermo/client";
import { SermoError } from "@/lib/sermo/errors";
import { attempt } from "@/lib/sermo/outcome";

export type ReplyState = {
  error?: string;
};

export async function replyAction(
  threadId: number,
  _previous: ReplyState,
  formData: FormData,
): Promise<ReplyState> {
  const body = String(formData.get("body") ?? "");
  const created = await attempt(`/threads/${threadId}`, () =>
    call(postsCreate, { threadId, body }),
  );
  if (!created.ok) return { error: created.error };
  const { id, position } = created.value;
  redirect(threadHref(threadId, position, id));
}

// Called by the page itself once it is shown, so a refusal (a dead session, a thread that
// vanished) is nothing the visitor needs to hear about.
export async function markRead(threadId: number, position: number) {
  try {
    await call(threadsMarkRead, { threadId, position });
  } catch (error) {
    if (!(error instanceof SermoError)) throw error;
  }
}
