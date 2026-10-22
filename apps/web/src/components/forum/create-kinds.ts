// What the Create button offers to post, decided from what the member may do. Pure, so the rules are
// held by tests.

import type { ForumChoice } from "@/components/forum/forum-choices";

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

export type CreateStep = "kind" | "forum" | "compose";

// Where a choice leads: a wall post goes straight to the composer, a thread to the choice of forum
// unless one was chosen already.
export function stepAfterPick(
  kind: CreateKind,
  forumId: number | null,
): CreateStep {
  return kind === "wall" || forumId !== null ? "compose" : "forum";
}

type Root = Pick<ParentNode, "querySelector">;

// The first option of the choice takes focus. False when there is none (not drawn yet).
export function focusFirstOption(root: Root | null | undefined) {
  const option = root?.querySelector<HTMLElement>("[data-create-option]");
  option?.focus();
  return !!option;
}

// The field of the composer that is shown takes focus: the title of a thread, the text of a wall
// post.
export function focusComposer(
  root: Root | null | undefined,
  mode: "thread" | "wall",
) {
  const shown = root?.querySelector(`[data-create-mode="${mode}"]`);
  const field = shown?.querySelector<HTMLElement>(
    'input[name="title"], textarea, [contenteditable]',
  );
  field?.focus();
  return !!field;
}

// `/forums/<id>/new` is a thread composer of its own, sharing the draft kept in the tab: the
// dialog does not offer threads there, so the two never write over each other.
export const onNewThreadPage = (pathname: string) =>
  /^\/forums\/[^/]+\/new\/?$/.test(pathname);

// The options, in the order they are drawn. A member who may post in no forum gets the wall post
// alone, and one who may post on no wall gets the threads alone; with neither there is nothing.
export function createOptions(
  data: CreateData,
  threadsHere = true,
): CreateKind[] {
  const kinds: CreateKind[] = [];
  if (threadsHere && postableForums(data.forums).length > 0) {
    kinds.push("discussion", "question", "poll");
  }
  if (data.canWall) kinds.push("wall");
  return kinds;
}
