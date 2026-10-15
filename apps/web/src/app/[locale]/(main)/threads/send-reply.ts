import "server-only";

import { postsCreate } from "@sermo/core/contracts";
import { call } from "@/lib/sermo/client";
import { formIds, requireIds } from "@/lib/sermo/ids";
import { attempt } from "@/lib/sermo/outcome";

// Adds the reply of a reply form to a thread: the one write both reply actions make, the one that
// ends in a redirect and the one that answers with the drawn post.
export function sendReply(threadId: number, formData: FormData) {
  requireIds(threadId);
  const body = String(formData.get("body") ?? "");
  const attachmentIds = formIds(formData, "attachmentIds");
  return attempt(`/threads/${threadId}`, () =>
    call(postsCreate, { threadId, body, attachmentIds }),
  );
}
