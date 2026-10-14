"use server";

import { nodesUnwatch, nodesWatch, threadsCreate } from "@sermo/core/contracts";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import type { FormState } from "@/app/[locale]/(main)/threads/actions";
import { call } from "@/lib/sermo/client";
import { parseId, requireIds } from "@/lib/sermo/ids";
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
  requireIds(nodeId);
  const title = String(formData.get("title") ?? "");
  const body = String(formData.get("body") ?? "");
  const prefixId = String(formData.get("prefixId") ?? "");
  if (prefixId) requireIds(parseId(prefixId));
  const attachmentIds = formData
    .getAll("attachmentIds")
    .map((value) => parseId(String(value)));
  requireIds(...attachmentIds);

  const created = await attempt(`/forums/${nodeId}/new`, () =>
    call(threadsCreate, {
      nodeId,
      title,
      body,
      attachmentIds: attachmentIds as number[],
      prefixId: prefixId ? (parseId(prefixId) as number) : null,
    }),
  );
  if (!created.ok) return { error: created.error, title, prefixId };
  // A thread that waits for approval is opened all the same: its author can see it there.
  redirect(`/threads/${created.value.thread.id}`);
}

export async function watchForumAction(
  nodeId: number,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  requireIds(nodeId);
  const mode = formData.get("mode") === "posts" ? "posts" : "threads";
  const done = await attempt(`/forums/${nodeId}`, () =>
    call(nodesWatch, { nodeId, mode, email: formData.get("email") === "on" }),
  );
  if (!done.ok) return { error: done.error };
  refresh();
  redirect(`/forums/${nodeId}`);
}

export async function unwatchForumAction(
  nodeId: number,
  _previous: FormState,
): Promise<FormState> {
  requireIds(nodeId);
  const done = await attempt(`/forums/${nodeId}`, () =>
    call(nodesUnwatch, { nodeId }),
  );
  if (!done.ok) return { error: done.error };
  refresh();
  redirect(`/forums/${nodeId}`);
}
