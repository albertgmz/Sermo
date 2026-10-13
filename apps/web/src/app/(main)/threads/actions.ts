"use server";

import {
  postsCreate,
  postsDelete,
  postsGet,
  postsRestore,
  postsUpdate,
  reportsCreate,
  threadsDelete,
  threadsGet,
  threadsMarkRead,
  threadsMerge,
  threadsMove,
  threadsRemoveCover,
  threadsRestore,
  threadsSetLocked,
  threadsSetSticky,
  threadsSplit,
  threadsUnwatch,
  threadsUpdate,
  threadsWatch,
} from "@sermo/core/contracts";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { threadHref } from "@/app/(main)/threads/[id]/pages";
import { parseThreadRef } from "@/app/(main)/threads/[id]/thread-ref";
import { call } from "@/lib/sermo/client";
import { SermoError } from "@/lib/sermo/errors";
import { formIds, parseId, requireIds } from "@/lib/sermo/ids";
import { attempt } from "@/lib/sermo/outcome";

export type ReplyState = {
  error?: string;
};

// What a form shows after an action: the backend's refusal, or that the work is done.
export type FormState = { error?: string; done?: boolean };

// Shows the thread again after something changed in it. The page the member is on may carry a hash
// (a reply or a post action leaves one), and an address that differs from it by nothing else is no
// navigation to the server, so the page is refreshed first.
function backToThread(threadId: number): never {
  refresh();
  redirect(`/threads/${threadId}`);
}

// Goes to a post of the thread the member is already reading. An address that differs only by its
// hash is no navigation to the server, so the page is refreshed first to show what changed.
function backToPost(href: string): never {
  refresh();
  redirect(href);
}

const textOf = (formData: FormData, name: string) =>
  String(formData.get(name) ?? "");

export async function replyAction(
  threadId: number,
  _previous: ReplyState,
  formData: FormData,
): Promise<ReplyState> {
  requireIds(threadId);
  const body = textOf(formData, "body");
  const attachmentIds = formIds(formData, "attachmentIds");
  const created = await attempt(`/threads/${threadId}`, () =>
    call(postsCreate, { threadId, body, attachmentIds }),
  );
  if (!created.ok) return { error: created.error };
  const { id, position } = created.value;
  backToPost(threadHref(threadId, position, id));
}

// Saves an edited post; when the form also carries a title, that is saved first, as the title is
// the more likely of the two to be refused.
export async function editPostAction(
  threadId: number,
  postId: number,
  _previous: ReplyState,
  formData: FormData,
): Promise<ReplyState> {
  requireIds(threadId, postId);
  const returnTo = `/threads/${threadId}/edit/${postId}`;
  // The title is only saved when it is not what the form was opened with.
  const title = formData.get("title");
  const prefix = textOf(formData, "prefixId");
  if (
    title !== null &&
    (String(title) !== textOf(formData, "titleWas") ||
      prefix !== textOf(formData, "prefixWas"))
  ) {
    const prefixId = prefix ? parseId(prefix) : null;
    if (prefix) requireIds(prefixId);
    const renamed = await attempt(returnTo, () =>
      call(threadsUpdate, { threadId, title: String(title), prefixId }),
    );
    if (!renamed.ok) return { error: renamed.error };
  }
  const saved = await attempt(returnTo, () =>
    call(postsUpdate, {
      postId,
      body: textOf(formData, "body"),
      reason: textOf(formData, "reason"),
      // A form without the file list leaves the files as they are.
      attachmentIds: formData.has("attachments")
        ? formIds(formData, "attachmentIds")
        : undefined,
    }),
  );
  if (!saved.ok) return { error: saved.error };
  redirect(threadHref(threadId, saved.value.position, postId));
}

export async function deletePostAction(
  threadId: number,
  postId: number,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  requireIds(threadId, postId);
  const deleted = await attempt(`/threads/${threadId}`, () =>
    call(postsDelete, { postId, reason: textOf(formData, "reason") }),
  );
  if (!deleted.ok) return { error: deleted.error };
  backToPost(threadHref(threadId, deleted.value.position, postId));
}

export async function restorePostAction(
  threadId: number,
  postId: number,
  _previous: FormState,
): Promise<FormState> {
  requireIds(threadId, postId);
  const restored = await attempt(`/threads/${threadId}`, () =>
    call(postsRestore, { postId }),
  );
  if (!restored.ok) return { error: restored.error };
  backToPost(threadHref(threadId, restored.value.position, postId));
}

export async function deleteThreadAction(
  threadId: number,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  requireIds(threadId);
  const deleted = await attempt(`/threads/${threadId}`, () =>
    call(threadsDelete, { threadId, reason: textOf(formData, "reason") }),
  );
  if (!deleted.ok) return { error: deleted.error };
  backToThread(threadId);
}

export async function restoreThreadAction(
  threadId: number,
  _previous: FormState,
): Promise<FormState> {
  requireIds(threadId);
  const restored = await attempt(`/threads/${threadId}`, () =>
    call(threadsRestore, { threadId }),
  );
  if (!restored.ok) return { error: restored.error };
  backToThread(threadId);
}

export async function setStickyAction(
  threadId: number,
  isSticky: boolean,
  _previous: FormState,
): Promise<FormState> {
  requireIds(threadId);
  const done = await attempt(`/threads/${threadId}`, () =>
    call(threadsSetSticky, { threadId, isSticky }),
  );
  if (!done.ok) return { error: done.error };
  backToThread(threadId);
}

export async function setLockedAction(
  threadId: number,
  isLocked: boolean,
  _previous: FormState,
): Promise<FormState> {
  requireIds(threadId);
  const done = await attempt(`/threads/${threadId}`, () =>
    call(threadsSetLocked, { threadId, isLocked }),
  );
  if (!done.ok) return { error: done.error };
  backToThread(threadId);
}

export async function removeCoverAction(
  threadId: number,
  _previous: FormState,
): Promise<FormState> {
  requireIds(threadId);
  const done = await attempt(`/threads/${threadId}`, () =>
    call(threadsRemoveCover, { threadId }),
  );
  if (!done.ok) return { error: done.error };
  backToThread(threadId);
}

export async function moveThreadAction(
  threadId: number,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  requireIds(threadId);
  const forum = textOf(formData, "nodeId");
  if (!forum) {
    return { error: (await getTranslations("threads.errors"))("noForum") };
  }
  const nodeId = parseId(forum);
  requireIds(nodeId);
  const done = await attempt(`/threads/${threadId}`, () =>
    call(threadsMove, { threadId, nodeId: nodeId as number }),
  );
  if (!done.ok) return { error: done.error };
  backToThread(threadId);
}

// What the first step of a merge answers: the thread the moderator named, as the backend shows it,
// or the refusal. `submitted` is the text it answers, so a form can tell a stale answer.
export type MergePreview = {
  submitted?: string;
  error?: string;
  target?: { id: number; title: string; forum: string };
};

// Reads the thread a merge would go into so that the moderator sees what they named before the
// merge itself; it changes nothing and does not count as a view.
export async function previewMergeAction(
  threadId: number,
  _previous: MergePreview,
  formData: FormData,
): Promise<MergePreview> {
  requireIds(threadId);
  const submitted = textOf(formData, "target");
  const id = parseThreadRef(submitted);
  if (id === null) {
    return {
      submitted,
      error: (await getTranslations("threads.errors"))("notThread"),
    };
  }
  const found = await attempt(`/threads/${threadId}`, () =>
    call(threadsGet, { threadId: id, countView: false }),
  );
  if (!found.ok) return { submitted, error: found.error };
  const { thread, node } = found.value;
  return {
    submitted,
    target: { id: thread.id, title: thread.title, forum: node.title },
  };
}

// Merges this thread into the one the moderator names; the old address keeps resolving to it.
export async function mergeThreadAction(
  threadId: number,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  requireIds(threadId);
  const target = parseThreadRef(textOf(formData, "target"));
  if (target === null) {
    return { error: (await getTranslations("threads.errors"))("notThread") };
  }
  const done = await attempt(`/threads/${threadId}`, () =>
    call(threadsMerge, { threadId: target, sourceThreadIds: [threadId] }),
  );
  if (!done.ok) return { error: done.error };
  redirect(`/threads/${target}`);
}

export async function splitThreadAction(
  threadId: number,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  requireIds(threadId);
  const postIds = formIds(formData, "postIds");
  const forum = textOf(formData, "nodeId");
  const errors = await getTranslations("threads.errors");
  if (postIds.length === 0) return { error: errors("noPosts") };
  if (!forum) return { error: errors("noForum") };
  const nodeId = parseId(forum);
  requireIds(nodeId);
  const done = await attempt(`/threads/${threadId}`, () =>
    call(threadsSplit, {
      threadId,
      postIds,
      title: textOf(formData, "title"),
      nodeId: nodeId as number,
      reason: textOf(formData, "reason"),
    }),
  );
  if (!done.ok) return { error: done.error };
  redirect(`/threads/${done.value.thread.id}`);
}

export async function watchThreadAction(
  threadId: number,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  requireIds(threadId);
  const done = await attempt(`/threads/${threadId}`, () =>
    call(threadsWatch, { threadId, email: formData.get("email") === "on" }),
  );
  if (!done.ok) return { error: done.error };
  backToThread(threadId);
}

export async function unwatchThreadAction(
  threadId: number,
  _previous: FormState,
): Promise<FormState> {
  requireIds(threadId);
  const done = await attempt(`/threads/${threadId}`, () =>
    call(threadsUnwatch, { threadId }),
  );
  if (!done.ok) return { error: done.error };
  backToThread(threadId);
}

export async function reportPostAction(
  postId: number,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  requireIds(postId);
  const done = await attempt("/", () =>
    call(reportsCreate, {
      target: { type: "post", id: postId },
      reason: textOf(formData, "reason"),
    }),
  );
  return done.ok ? { done: true } : { error: done.error };
}

// The Markdown source of a post, for the quote button: the list only carries rendered HTML.
export async function quoteSource(postId: number) {
  requireIds(postId);
  try {
    const { author, bodySource } = await call(postsGet, { postId });
    return { author: author.username, source: bodySource };
  } catch (error) {
    if (!(error instanceof SermoError)) throw error;
    return null;
  }
}

// Called by the page itself once it is shown, so a refusal (a dead session, a thread that
// vanished) is nothing the visitor needs to hear about.
export async function markRead(threadId: number, position: number) {
  requireIds(threadId);
  try {
    await call(threadsMarkRead, { threadId, position });
  } catch (error) {
    if (!(error instanceof SermoError)) throw error;
  }
}
