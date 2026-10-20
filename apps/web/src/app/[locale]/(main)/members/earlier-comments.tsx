"use server";

import { profileCommentsList } from "@sermo/core/contracts";
import type { EarlierPage } from "@/components/forum/earlier-comments";
import {
  type ApiWallComment,
  oldestFirst,
  WallCommentRows,
} from "@/components/forum/wall-comments";
import { call } from "@/lib/sermo/client";
import { SermoError } from "@/lib/sermo/errors";
import { requireIds } from "@/lib/sermo/ids";
import { membersFor } from "@/lib/sermo/members";
import { getReactionTypes, pickerTypes } from "@/lib/sermo/reactions";
import { getViewer } from "@/lib/sermo/session";

// At most this many pages of comments are read in one call; the button stays for the rest.
const MAX_PAGES = 50;

// The comments on a wall post before those a list shows, drawn as the list draws its own (see
// `EarlierComments`). Pages are read from `from` (null: the newest) and each comment at or past
// `beforeId` (the oldest the list shows, when it starts from the newest) is left out. `through`:
// pages are read until one holds a comment at or before this id; null reads one page. Every call
// reads the range again from the start, so a list drawn again (after a comment, an edit, a
// deletion) is matched by the comments loaded into it.
export async function earlierComments(
  profilePostId: number,
  profileUserId: number,
  beforeId: number | null,
  from: string | null,
  through: number | null,
): Promise<EarlierPage> {
  requireIds(profilePostId, profileUserId);
  if (beforeId !== null) requireIds(beforeId);
  if (through !== null) requireIds(through);
  if (from !== null && typeof from !== "string")
    throw new SermoError("validation", 422, "Not a cursor.");
  const [viewer, reactionTypes] = await Promise.all([
    getViewer(),
    getReactionTypes(),
  ]);
  const read: ApiWallComment[] = [];
  let cursor = from;
  let nextCursor: string | null = null;
  for (let pages = 0; pages < MAX_PAGES; pages += 1) {
    const page = await call(profileCommentsList, {
      profilePostId,
      cursor: cursor ?? undefined,
    });
    read.push(...page.items);
    nextCursor = page.nextCursor;
    const lowest = Math.min(...page.items.map((comment) => comment.id));
    if (nextCursor === null || through === null || lowest <= through) break;
    cursor = nextCursor;
  }
  const comments = read.filter(
    (comment) => beforeId === null || comment.id < beforeId,
  );
  const member = await membersFor([
    ...comments.map((comment) => comment.author),
    ...(viewer.user ? [viewer.user] : []),
  ]);
  const picker =
    viewer.permissions.canReact &&
    viewer.resolvedPermissions["profilePost.react"] !== false
      ? pickerTypes(reactionTypes, null)
      : [];
  const rows = {
    profileUserId,
    member,
    viewerId: viewer.user?.id ?? null,
    picker,
    reactionTypes,
    viewList: viewer.resolvedPermissions["reaction.viewList"] !== false,
  };
  return {
    rows: oldestFirst(comments).map((comment) => ({
      id: comment.id,
      node: <WallCommentRows comments={[comment]} {...rows} />,
    })),
    nextCursor,
    oldest: read.length ? Math.min(...read.map((comment) => comment.id)) : null,
  };
}
