"use server";

import {
  postsPage,
  threadsPage,
} from "@/app/[locale]/(main)/members/[id]/activity-page";
import { call } from "@/lib/sermo/client";
import { endQuietly } from "@/lib/sermo/list-actions";

// A page of a member's posts or threads after the first, drawn on the server so the bodies keep
// reading the LITE cookie. Called as the visitor scrolls; `null` is the first page.
export async function moreActivity(
  kind: "posts" | "threads",
  userId: number,
  cursor: string | null,
) {
  return endQuietly(() =>
    kind === "posts"
      ? postsPage(userId, cursor ?? undefined, call)
      : threadsPage(userId, cursor ?? undefined, call),
  );
}
