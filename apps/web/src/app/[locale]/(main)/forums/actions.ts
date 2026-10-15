"use server";

import {
  nodesGet,
  nodesUnwatch,
  nodesWatch,
  threadsBatchUpdate,
  threadsCreate,
} from "@sermo/core/contracts";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type * as z from "zod";
import type { FormState } from "@/app/[locale]/(main)/threads/actions";
import {
  BATCH_LIMIT,
  type BatchState,
} from "@/components/staff/thread-batch-state";
import { call } from "@/lib/sermo/client";
import { formIds, parseId, requireIds } from "@/lib/sermo/ids";
import { attempt } from "@/lib/sermo/outcome";
import { tagsFromText } from "@/lib/sermo/tags";

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
      tags: tagsFromText(String(formData.get("tags") ?? "")),
    }),
  );
  if (!created.ok) return { error: created.error, title, prefixId };
  // A thread that waits for approval is opened all the same: its author can see it there.
  redirect(`/threads/${created.value.thread.id}`);
}

// Whether the member may attach files to a thread in this forum, for a composer whose forum was
// changed after the page was drawn. A forum that cannot be read says no.
export async function forumAttachAllowedAction(
  nodeId: number,
): Promise<boolean> {
  requireIds(nodeId);
  const read = await attempt(`/forums/${nodeId}/new`, () =>
    call(nodesGet, { nodeId }),
  );
  return (
    read.ok &&
    read.value.resolvedPermissions["forum.uploadAttachments"] === true
  );
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

type BatchUpdate = z.input<typeof threadsBatchUpdate.input>["update"];

// Applies one change to the threads ticked on a forum's list. The backend judges every thread
// itself and answers for each; the form is told how many changed and why the others were refused.
export async function batchUpdateThreadsAction(
  nodeId: number,
  _previous: BatchState,
  formData: FormData,
): Promise<BatchState> {
  requireIds(nodeId);
  const t = await getTranslations("forums.forum");
  const threadIds = formIds(formData, "threadIds");
  if (threadIds.length === 0) return { error: t("batchChoose") };
  if (threadIds.length > BATCH_LIMIT) return { error: t("batchTooMany") };
  const name = String(formData.get("action") ?? "");
  let update: BatchUpdate;
  if (name === "move") {
    const forum = parseId(String(formData.get("forumId") ?? ""));
    if (forum === null) {
      return { error: (await getTranslations("threads.errors"))("noForum") };
    }
    update = { action: "move", nodeId: forum };
  } else if (name === "setPrefix") {
    const raw = String(formData.get("prefixId") ?? "");
    const prefixId = raw === "" ? null : parseId(raw);
    if (raw !== "" && prefixId === null) return { error: t("batchChoose") };
    update = { action: "setPrefix", prefixId };
  } else if (
    [
      "lock",
      "unlock",
      "stick",
      "unstick",
      "feature",
      "unfeature",
      "delete",
      "restore",
    ].includes(name)
  ) {
    update = { action: name } as BatchUpdate;
  } else {
    return { error: t("batchChoose") };
  }
  const done = await attempt(`/forums/${nodeId}`, () =>
    call(threadsBatchUpdate, {
      threadIds,
      update,
      reason: String(formData.get("reason") ?? ""),
    }),
  );
  if (!done.ok) return { error: done.error };
  const { results } = done.value;
  const refused = results.filter((result) => result.error);
  const changed = results.filter(
    (result) => !result.error && result.changed,
  ).length;
  const same = results.length - refused.length - changed;
  refresh();
  const summary = [
    t("batchDone", { changed, same }),
    refused.length > 0
      ? t("batchRefused", {
          count: refused.length,
          reasons: [
            ...new Set(refused.map((result) => result.error?.message)),
          ].join(" "),
        })
      : "",
  ]
    .filter(Boolean)
    .join(" ");
  return { done: true, summary };
}
