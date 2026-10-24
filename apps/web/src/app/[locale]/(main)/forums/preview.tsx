"use server";

import { postsPreview } from "@sermo/core/contracts";
import type * as z from "zod";
import { conversationHref } from "@/app/[locale]/(main)/conversations/[id]/message-target";
import { threadPageHref } from "@/app/[locale]/(main)/threads/[id]/pages";
import { HtmlContent } from "@/components/forum/html-content";
import { call } from "@/lib/sermo/client";
import { requireIds } from "@/lib/sermo/ids";
import { attempt } from "@/lib/sermo/outcome";

type Target = z.input<typeof postsPreview.input>["target"];

// The target as the backend reads it, from what the browser sent: only its own fields, ids checked.
// With the address a refused sign-in comes back to.
function where(target: Target): { target: Target; returnTo: string } {
  if (target.type === "thread") {
    requireIds(target.nodeId);
    return {
      target: { type: "thread", nodeId: target.nodeId },
      returnTo: `/forums/${target.nodeId}/new`,
    };
  }
  if (target.type === "reply") {
    requireIds(target.threadId);
    return {
      target: { type: "reply", threadId: target.threadId },
      returnTo: threadPageHref(target.threadId, 1),
    };
  }
  if (target.conversationId === undefined)
    return { target: { type: "message" }, returnTo: "/conversations/new" };
  requireIds(target.conversationId);
  return {
    target: { type: "message", conversationId: target.conversationId },
    returnTo: conversationHref(target.conversationId),
  };
}

// A composer's Preview, XenForo's "Preview": the text rendered by the backend as posting it there
// would store it, drawn as a post's body is (`HtmlContent`), or the backend's refusal. Nothing is
// saved and nothing navigates: the composer shows the answer in place of its text.
export async function previewAction(
  target: Target,
  body: string,
): Promise<{ preview: React.ReactNode } | { error: string }> {
  const at = where(target);
  const done = await attempt(at.returnTo, () =>
    call(postsPreview, { target: at.target, body: String(body) }),
  );
  if (!done.ok) return { error: done.error };
  return { preview: <HtmlContent>{done.value.html}</HtmlContent> };
}
