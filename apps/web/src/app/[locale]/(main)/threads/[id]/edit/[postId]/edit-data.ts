import "server-only";

import {
  nodesGet,
  postsGet,
  threadPrefixesList,
  threadsGet,
} from "@sermo/core/contracts";
import { getTranslations } from "next-intl/server";
import type * as z from "zod";
import { threadMay } from "@/app/[locale]/(main)/threads/[id]/permissions";
import { fileName } from "@/app/[locale]/(main)/threads/[id]/post-attachments";
import type { AttachedFile } from "@/components/forum/attachment-field";
import type { call } from "@/lib/sermo/client";
import { activePrefixViews, prefixChoices } from "@/lib/sermo/threads";
import type { PrefixView } from "@/lib/sermo/views";

// The title and prefix of a thread as its edit forms open with them, and what they offer.
export type ThreadEditFields = {
  title: string;
  prefixId: string;
  prefixes: PrefixView[];
  mustHavePrefix: boolean;
};

// What a form that edits a post opens with: the BB code it was written in, where to attach files
// (when the viewer may), the files it has, and the thread's title and prefix for its opening post
// when the viewer may change them.
export type PostEditFields = {
  source: string;
  attachIn: number | null;
  attached: AttachedFile[];
  thread: ThreadEditFields | null;
};

// The title and prefix of a thread for a form that changes them: the prefixes its forum offers,
// the thread's own kept when it is no longer one of them.
export async function threadEditFields(
  ask: typeof call,
  found: z.output<typeof threadsGet.output>,
): Promise<ThreadEditFields> {
  const { thread, node, resolvedPermissions } = found;
  const [prefixes, requirePrefix, t] = await Promise.all([
    ask(threadPrefixesList, { nodeId: node.id }).then(({ items }) =>
      activePrefixViews(items),
    ),
    // Only a thread that has a prefix can be kept from losing it.
    thread.prefix
      ? ask(nodesGet, { nodeId: node.id }).then(
          (read) => read.node.settings.requirePrefix,
        )
      : false,
    getTranslations("threads.edit"),
  ]);
  return {
    title: thread.title,
    prefixId: thread.prefix ? String(thread.prefix.id) : "",
    prefixes: prefixChoices(prefixes, thread.prefix, (label) =>
      t("inactivePrefix", { label }),
    ),
    // As the backend applies it: the author may not take the prefix off where the forum requires
    // one it offers; a moderator may.
    mustHavePrefix:
      requirePrefix &&
      prefixes.length > 0 &&
      resolvedPermissions["forum.editAny"] !== true,
  };
}

// The post and its thread, and what the edit form opens with; null when the post is not one of
// that thread's. `ask` is `read` for a page (a missing post is its 404) or `call` for an action.
export async function loadPostEdit(
  ask: typeof call,
  threadId: number,
  postId: number,
) {
  const [post, found] = await Promise.all([
    ask(postsGet, { postId }),
    ask(threadsGet, { threadId, countView: false }),
  ]);
  if (post.threadId !== threadId) return null;
  const opening =
    post.id === found.thread.firstPostId && found.permissions.canEditTitle;
  const fields: PostEditFields = {
    source: post.bodySource,
    attachIn: threadMay(found.resolvedPermissions).attach
      ? found.node.id
      : null,
    attached: post.attachments.map((file) => ({
      id: file.fileId,
      name: fileName(file),
      size: file.byteSize,
      type: file.contentType,
    })),
    thread: opening ? await threadEditFields(ask, found) : null,
  };
  return { post, found, fields };
}
