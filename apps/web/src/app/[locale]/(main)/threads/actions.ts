"use server";

import {
  postsDelete,
  postsGet,
  postsHardDelete,
  postsRestore,
  threadsDelete,
  threadsGet,
  threadsHardDelete,
  threadsMarkRead,
  threadsMerge,
  threadsMove,
  threadsRemoveCover,
  threadsRestore,
  threadsSetFeatured,
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
import { threadHref } from "@/app/[locale]/(main)/threads/[id]/pages";
import { parseThreadRef } from "@/app/[locale]/(main)/threads/[id]/thread-ref";
import { saveEdit } from "@/app/[locale]/(main)/threads/save-edit";
import { sendReply } from "@/app/[locale]/(main)/threads/send-reply";
import type { ChangeResult } from "@/lib/item-state";
import { call } from "@/lib/sermo/client";
import { eraseHidingFirst } from "@/lib/sermo/erase";
import { SermoError } from "@/lib/sermo/errors";
import { formIds, parseId, requireIds } from "@/lib/sermo/ids";
import { attempt, attemptInPlace } from "@/lib/sermo/outcome";
import { tagsFromText } from "@/lib/sermo/tags";

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

// The delete dialog says which deletion it wants (`DeleteDialog`).
const wantsHardDelete = (formData: FormData) =>
  formData.get("hardDelete") === "1";

export async function replyAction(
  threadId: number,
  _previous: ReplyState,
  formData: FormData,
): Promise<ReplyState> {
  const created = await sendReply(threadId, formData);
  if (!created.ok) return { error: created.error };
  const { id, position } = created.value;
  backToPost(threadHref(threadId, position, id));
}

// Saves an edited post (`saveEdit`) and goes back to it.
export async function editPostAction(
  threadId: number,
  postId: number,
  _previous: ReplyState,
  formData: FormData,
): Promise<ReplyState> {
  const saved = await saveEdit(threadId, postId, formData);
  if (!saved.ok) return { error: saved.error };
  redirect(threadHref(threadId, saved.value.post.position, postId));
}

export async function deletePostAction(
  threadId: number,
  postId: number,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  requireIds(threadId, postId);
  if (wantsHardDelete(formData))
    return hardDeletePostAction(threadId, postId, _previous, formData);
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
  if (wantsHardDelete(formData))
    return hardDeleteThreadAction(threadId, _previous, formData);
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

// A large thread is erased by the backend in steps of 500 posts, one call each. One request makes
// at most this many calls, so its work stays bounded; the button can be pressed again to go on.
const HARD_DELETE_CALLS = 20;

// Erases a deleted thread for good and goes to its forum.
export async function hardDeleteThreadAction(
  threadId: number,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  requireIds(threadId);
  const reason = textOf(formData, "reason");
  // The forum is read first: once the thread is gone there is nothing to ask.
  const found = await attempt(`/threads/${threadId}`, () =>
    call(threadsGet, { threadId, countView: false }),
  );
  if (!found.ok) return { error: found.error };
  let hidden = false;
  const hideFirst = async () => {
    // A staff member's live thread is hidden first; an author's own is refused as it is.
    if (hidden || found.value.thread.state === "deleted") return false;
    if (found.value.permissions.canHardDelete) return false;
    await call(threadsDelete, { threadId, reason, notify: false });
    hidden = true;
    return true;
  };
  for (let step = 0; step < HARD_DELETE_CALLS; step++) {
    const erased = await attempt(`/threads/${threadId}`, () =>
      eraseHidingFirst(
        () => call(threadsHardDelete, { threadId, reason }),
        hideFirst,
      ),
    );
    if (!erased.ok) return { error: erased.error };
    if (erased.value.completed) {
      refresh();
      redirect(`/forums/${found.value.node.id}`);
    }
  }
  return {
    error: (await getTranslations("threads.moderation"))("hardDeleteMore"),
  };
}

// Erases a deleted reply for good and shows the thread again.
export async function hardDeletePostAction(
  threadId: number,
  postId: number,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  requireIds(threadId, postId);
  const reason = textOf(formData, "reason");
  const erased = await attempt(`/threads/${threadId}`, () =>
    eraseHidingFirst(
      () => call(postsHardDelete, { postId, reason }),
      async () => {
        // A staff member's live reply is hidden first; an author's own is refused as it is.
        const { state, canHardDelete } = await call(postsGet, { postId });
        if (state === "deleted" || canHardDelete) return false;
        await call(postsDelete, { postId, reason, notify: false });
        return true;
      },
    ),
  );
  if (!erased.ok) return { error: erased.error };
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

export async function setFeaturedAction(
  threadId: number,
  isFeatured: boolean,
  _previous: FormState,
): Promise<FormState> {
  requireIds(threadId);
  const done = await attempt(`/threads/${threadId}`, () =>
    call(threadsSetFeatured, { threadId, isFeatured }),
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

// Replaces the tags of a thread with the ones the field holds; the page is drawn again with them.
export async function setThreadTagsAction(
  threadId: number,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  requireIds(threadId);
  const done = await attempt(`/threads/${threadId}`, () =>
    call(threadsUpdate, {
      threadId,
      tags: tagsFromText(textOf(formData, "tags")),
    }),
  );
  if (!done.ok) return { error: done.error };
  refresh();
  return { done: true };
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

// Watches a thread, changes its email choice, or stops watching it (`null`), from the watch
// popover, which has already shown the change: nothing on the page is drawn again (the page and
// the reply being typed stay as they are).
export async function setThreadWatch(
  threadId: number,
  watch: { email: boolean } | null,
): Promise<ChangeResult> {
  requireIds(threadId);
  const done = await attemptInPlace<unknown>(`/threads/${threadId}`, () =>
    watch
      ? call(threadsWatch, { threadId, email: watch.email === true })
      : call(threadsUnwatch, { threadId }),
  );
  if (!done.ok) return { error: done.error, signIn: done.signIn };
  return {};
}

// The BB code source of a post, for the quote button: the list only carries rendered HTML.
export async function quoteSource(postId: number) {
  requireIds(postId);
  try {
    const { author, bodySource } = await call(postsGet, { postId });
    return { author: author.username, authorId: author.id, source: bodySource };
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
