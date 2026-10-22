"use server";

import {
  nodesGet,
  nodesMarkAllRead,
  nodesMarkRead,
  nodesUnwatch,
  nodesWatch,
  threadPrefixesList,
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
import { pollFromJson } from "@/lib/sermo/polls";
import { tagsFromText } from "@/lib/sermo/tags";
import { activePrefixViews } from "@/lib/sermo/threads";
import type { PrefixView } from "@/lib/sermo/views";

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

  // A poll field that is not a poll refuses the thread: it must not be sent without it, silently.
  const pollText = String(formData.get("poll") ?? "");
  const poll = pollFromJson(pollText);
  if (pollText.trim() !== "" && !poll)
    return {
      error: (await getTranslations("forum.poll"))("invalid"),
      title,
      prefixId,
    };

  const created = await attempt(`/forums/${nodeId}/new`, () =>
    call(threadsCreate, {
      nodeId,
      title,
      body,
      attachmentIds: attachmentIds as number[],
      prefixId: prefixId ? (parseId(prefixId) as number) : null,
      tags: tagsFromText(String(formData.get("tags") ?? "")),
      poll: poll ?? undefined,
    }),
  );
  if (!created.ok) return { error: created.error, title, prefixId };
  // A thread that waits for approval is opened all the same: its author can see it there.
  redirect(`/threads/${created.value.thread.id}`);
}

// What the member may add to a thread in this forum, for a composer whose forum was changed after
// the page was drawn: files, and a poll or quiz; and the prefixes the forum offers, whether it asks
// for one. Null when the forum could not be read, which is not the same as a forum that allows
// neither.
export async function forumComposeAccessAction(nodeId: number): Promise<{
  attach: boolean;
  poll: boolean;
  prefixes: PrefixView[];
  requirePrefix: boolean;
} | null> {
  requireIds(nodeId);
  const [read, listed] = await Promise.all([
    attempt(`/forums/${nodeId}/new`, () => call(nodesGet, { nodeId })),
    attempt(`/forums/${nodeId}/new`, () =>
      call(threadPrefixesList, { nodeId }),
    ),
  ]);
  if (!read.ok || !listed.ok) return null;
  const allowed = read.value.resolvedPermissions;
  const prefixes = activePrefixViews(listed.value.items);
  return {
    attach: allowed["forum.uploadAttachments"] === true,
    poll: allowed["poll.create"] === true,
    prefixes,
    // As the backend applies it: a forum with nothing to choose from asks for nothing.
    requirePrefix:
      read.value.node.settings.requirePrefix && prefixes.length > 0,
  };
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

// "Mark forum read" and "Mark forums read": the backend stores one marker, however many threads
// there are. The page stays where it is and is drawn again, so the unread marks are gone from it.
export async function markForumReadAction(
  nodeId: number,
  _previous: FormState,
): Promise<FormState> {
  requireIds(nodeId);
  const done = await attempt(`/forums/${nodeId}`, () =>
    call(nodesMarkRead, { nodeId }),
  );
  if (!done.ok) return { error: done.error };
  refresh();
  return { done: true };
}

export async function markAllForumsReadAction(
  _previous: FormState,
): Promise<FormState> {
  const done = await attempt("/", () => call(nodesMarkAllRead, {}));
  if (!done.ok) return { error: done.error };
  refresh();
  return { done: true };
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
