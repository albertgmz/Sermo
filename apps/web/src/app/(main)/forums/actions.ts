"use server";

import { threadsCreate } from "@sermo/core/contracts";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { call } from "@/lib/sermo/client";
import { attempt } from "@/lib/sermo/outcome";

export type NewThreadState = {
  error?: string;
  title?: string;
  prefixId?: string;
};

export async function createThreadAction(
  nodeId: number,
  _previous: NewThreadState,
  formData: FormData,
): Promise<NewThreadState> {
  const title = String(formData.get("title") ?? "");
  const body = String(formData.get("body") ?? "");
  const prefixId = String(formData.get("prefixId") ?? "");

  const created = await attempt(`/forums/${nodeId}/new`, () =>
    call(threadsCreate, {
      nodeId,
      title,
      body,
      prefixId: prefixId ? Number(prefixId) : null,
    }),
  );
  if (!created.ok) return { error: created.error, title, prefixId };
  revalidatePath("/", "layout");
  // A thread that waits for approval is opened all the same: its author can see it there.
  redirect(`/threads/${created.value.thread.id}`);
}
