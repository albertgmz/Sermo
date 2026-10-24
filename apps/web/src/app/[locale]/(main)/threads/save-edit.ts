import "server-only";

import { postsUpdate, threadsUpdate } from "@sermo/core/contracts";
import { call } from "@/lib/sermo/client";
import { formIds, parseId, requireIds } from "@/lib/sermo/ids";
import { attempt } from "@/lib/sermo/outcome";

const textOf = (formData: FormData, name: string) =>
  String(formData.get(name) ?? "");

// Saves an edited post: the one write of the edit page and of the edit made where the post is
// read. When the form also carries a title, that is saved first, as the title is the more likely
// of the two to be refused; it is only saved when it is not what the form was opened with. The
// answer is the saved post, and the thread when its title or prefix was saved (also with a refusal
// of the post that came after it).
export async function saveEdit(
  threadId: number,
  postId: number,
  formData: FormData,
) {
  requireIds(threadId, postId);
  const returnTo = `/threads/${threadId}/edit/${postId}`;
  const title = formData.get("title");
  const prefix = textOf(formData, "prefixId");
  let renamed = null;
  if (
    title !== null &&
    (String(title) !== textOf(formData, "titleWas") ||
      prefix !== textOf(formData, "prefixWas"))
  ) {
    const prefixId = prefix ? parseId(prefix) : null;
    if (prefix) requireIds(prefixId);
    const saved = await attempt(returnTo, () =>
      call(threadsUpdate, { threadId, title: String(title), prefixId }),
    );
    if (!saved.ok) return saved;
    renamed = saved.value;
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
  // A title saved before a refused post stays saved: the refusal says so.
  if (!saved.ok) return { ...saved, thread: renamed };
  return {
    ok: true as const,
    value: { post: saved.value, thread: renamed },
  };
}
