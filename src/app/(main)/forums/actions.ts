"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getClientInfo } from "@/lib/client";
import { createThread, getForum } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";

const TITLE_MAX = 120;

export type NewThreadState = {
  error?: string;
  title?: string;
  prefixId?: string;
};

export async function createThreadAction(
  id: number,
  _previous: NewThreadState,
  formData: FormData,
): Promise<NewThreadState> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const title = String(formData.get("title") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  const prefixId = String(formData.get("prefixId") ?? "");
  const forum = await getForum(id);
  const fail = (error: string) => ({ error, title, prefixId });

  if (!forum) return fail("This forum no longer exists.");
  if (!title) return fail("Give your thread a title.");
  if (title.length > TITLE_MAX) {
    return fail(`Keep the title under ${TITLE_MAX} characters.`);
  }
  if (!body) return fail("Write a message for your thread.");

  const thread = await createThread({
    forumId: forum.id,
    authorId: user.id,
    title,
    body,
    prefixId: prefixId ? Number(prefixId) : null,
    client: await getClientInfo(),
  });
  revalidatePath("/forums");
  revalidatePath(`/forums/${forum.id}`);
  redirect(`/threads/${thread.id}`);
}
