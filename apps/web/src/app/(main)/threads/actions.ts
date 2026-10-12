"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getClientInfo } from "@/lib/client";
import {
  applyThreadCover,
  createPost,
  getThread,
  removeThreadCover,
  removeThreadCoverAsStaff,
} from "@/lib/db";
import { getCurrentUser } from "@/lib/session";

export type ReplyState = {
  error?: string;
};

export async function replyAction(
  threadId: number,
  _previous: ReplyState,
  formData: FormData,
): Promise<ReplyState> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const t = await getTranslations("threads.actions.errors");

  const body = String(formData.get("body") ?? "").trim();
  if (!body) return { error: t("emptyBody") };

  const thread = await getThread(threadId);
  if (!thread) return { error: t("threadNotFound") };

  const post = await createPost({
    threadId: thread.id,
    authorId: user.id,
    body,
    client: await getClientInfo(),
  });
  revalidatePath(`/threads/${thread.id}`);
  revalidatePath(`/forums/${thread.forum.id}`);
  revalidatePath("/forums");
  redirect(`/threads/${thread.id}#post-${post.id}`);
}

export type CoverState = {
  error: "no_cover" | "not_found" | "not_owned" | "not_author";
} | null;

export async function changeCover(
  threadId: number,
  _previous: CoverState,
  formData: FormData,
): Promise<CoverState> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const itemId = Number(formData.get("item"));
  if (!Number.isInteger(itemId) || itemId < 1) return { error: "no_cover" };
  const result = await applyThreadCover(user.id, itemId, threadId);
  if (!result.ok) return { error: result.error };
  revalidatePath("/", "layout");
  redirect(`/threads/${threadId}`);
}

export async function removeCover(
  threadId: number,
  _previous: CoverState,
  _formData: FormData,
): Promise<CoverState> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const thread = await getThread(threadId);
  if (!thread) return { error: "not_found" };
  const result =
    thread.authorId === user.id
      ? await removeThreadCover(user.id, threadId)
      : await removeThreadCoverAsStaff(user.id, threadId);
  if (!result.ok) return { error: result.error };
  revalidatePath("/", "layout");
  redirect(`/threads/${threadId}`);
}
