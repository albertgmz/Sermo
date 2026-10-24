"use server";

import { threadsGet, threadsUpdate } from "@sermo/core/contracts";
import {
  loadPostEdit,
  type PostEditFields,
  type ThreadEditFields,
  threadEditFields,
} from "@/app/[locale]/(main)/threads/[id]/edit/[postId]/edit-data";
import { PostBody } from "@/app/[locale]/(main)/threads/[id]/post-item";
import { saveEdit } from "@/app/[locale]/(main)/threads/save-edit";
import { EditedMark } from "@/components/forum/edited-mark";
import { quotable } from "@/components/forum/selection-bb";
import { call } from "@/lib/sermo/client";
import { parseId, requireIds } from "@/lib/sermo/ids";
import { attempt } from "@/lib/sermo/outcome";
import { prefixView } from "@/lib/sermo/threads";
import type { PrefixView } from "@/lib/sermo/views";

// The edits made where a thread is read, as XenForo's quick edit: what the editor opens with, and
// the saves, which answer with what changed (drawn as the page draws it) instead of a redirect, so
// only the post or the title is drawn again. The edit page stays for "More options" and for
// browsers without JavaScript; the writes are its own (`saveEdit`, threads.update).

// The thread's title as the page shows it after a save.
export type ThreadHeadingValue = { title: string; prefix: PrefixView | null };

// A refusal comes with the backend's words; an empty one is said by the editor in its own.
type Refused = { error: string };

// What a refused save of an opening post still changed: the title saved before the post was refused.
type Retitled = { thread?: ThreadHeadingValue };

const headingOf = (thread: {
  title: string;
  prefix: Parameters<typeof prefixView>[0];
}): ThreadHeadingValue => ({
  title: thread.title,
  prefix: prefixView(thread.prefix),
});

// What the post's editor opens with. A post the viewer may not edit, or that is not one of the
// thread's, opens nothing.
export async function postEditorAction(
  threadId: number,
  postId: number,
): Promise<{ fields: PostEditFields } | Refused> {
  requireIds(threadId, postId);
  const loaded = await attempt(`/threads/${threadId}`, () =>
    loadPostEdit(call, threadId, postId),
  );
  if (!loaded.ok) return { error: loaded.error };
  if (!loaded.value?.post.canEdit) return { error: "" };
  return { fields: loaded.value.fields };
}

// Saves the post's editor: the post's text and files as drawn now, when it was edited, and the
// thread's title when the opening post's editor changed it.
export async function savePostInPlace(
  threadId: number,
  postId: number,
  // The page drew the post quotable by selection; only the quoting itself (`quoteSource`) reads
  // the post, as the viewer may.
  canQuote: boolean,
  formData: FormData,
): Promise<
  | {
      body: React.ReactNode;
      edited: React.ReactNode;
      thread?: ThreadHeadingValue;
    }
  | (Refused & Retitled)
> {
  const saved = await saveEdit(threadId, postId, formData);
  if (!saved.ok) {
    return {
      error: saved.error,
      thread:
        "thread" in saved && saved.thread ? headingOf(saved.thread) : undefined,
    };
  }
  const { post, thread } = saved.value;
  return {
    body: (
      <PostBody
        post={post}
        className="md:mt-1"
        quote={
          canQuote && post.state === "visible"
            ? quotable("post", post.id, post.author)
            : undefined
        }
      />
    ),
    edited: post.editedAt && <EditedMark date={post.editedAt} />,
    thread: thread ? headingOf(thread) : undefined,
  };
}

// What the thread's editor opens with: its title and prefix, and the prefixes its forum offers.
export async function threadEditorAction(
  threadId: number,
): Promise<{ fields: ThreadEditFields } | Refused> {
  requireIds(threadId);
  const loaded = await attempt(`/threads/${threadId}`, async () => {
    const found = await call(threadsGet, { threadId, countView: false });
    return found.permissions.canEditTitle
      ? threadEditFields(call, found)
      : null;
  });
  if (!loaded.ok) return { error: loaded.error };
  if (!loaded.value) return { error: "" };
  return { fields: loaded.value };
}

// Saves the thread's title and prefix; one that was not changed is not saved again.
export async function saveThreadInPlace(
  threadId: number,
  formData: FormData,
): Promise<{ heading: ThreadHeadingValue | null } | Refused> {
  requireIds(threadId);
  const title = String(formData.get("title") ?? "");
  const prefix = String(formData.get("prefixId") ?? "");
  if (
    title === formData.get("titleWas") &&
    prefix === formData.get("prefixWas")
  ) {
    return { heading: null };
  }
  const prefixId = prefix ? parseId(prefix) : null;
  if (prefix) requireIds(prefixId);
  const saved = await attempt(`/threads/${threadId}`, () =>
    call(threadsUpdate, { threadId, title, prefixId }),
  );
  if (!saved.ok) return { error: saved.error };
  return { heading: headingOf(saved.value) };
}
