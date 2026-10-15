"use server";

import {
  postsPage,
  threadsPage,
} from "@/app/[locale]/(main)/members/[id]/activity-page";

// The next page of a member's posts or threads, drawn on the server so the bodies keep reading
// the LITE cookie. Called as the visitor scrolls.
export async function moreActivity(
  kind: "posts" | "threads",
  userId: number,
  cursor: string,
) {
  return kind === "posts"
    ? postsPage(userId, cursor)
    : threadsPage(userId, cursor);
}
