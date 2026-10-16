// What the Create button offers to post, decided from what the member may do. Pure, so the rules are
// held by tests.

import type { ForumChoice } from "@/components/forum/forum-choices";
import type { PrefixView } from "@/lib/sermo/views";

// A discussion, a question and a poll or quiz are threads; a wall post is a post on the member's own
// wall. The backend has no thread type for a question, so it is a discussion worded as one.
export type CreateKind = "discussion" | "question" | "poll" | "wall";
export type ThreadKind = Exclude<CreateKind, "wall">;

export const isThreadKind = (kind: CreateKind): kind is ThreadKind =>
  kind !== "wall";

// What the flow is given once it opens: the forums and the permissions that decide its options.
export type CreateData = {
  memberId: number;
  forums: ForumChoice[];
  prefixes: PrefixView[];
  // The member may put tags on a thread (tag.apply).
  canTag: boolean;
  // The member may post on their own wall (profilePost.postOwn).
  canWall: boolean;
};

export type CreateLoad = { ok: true; data: CreateData } | { ok: false };

// The forums a member may start a thread in; categories take none.
export function postableForums(forums: ForumChoice[]) {
  return forums.filter((forum) => forum.type === "forum" && forum.canPost);
}

// The options, in the order they are drawn. A member who may post in no forum gets the wall post
// alone, and one who may post on no wall gets the threads alone; with neither there is nothing.
export function createOptions(data: CreateData): CreateKind[] {
  const kinds: CreateKind[] = [];
  if (postableForums(data.forums).length > 0) {
    kinds.push("discussion", "question", "poll");
  }
  if (data.canWall) kinds.push("wall");
  return kinds;
}
