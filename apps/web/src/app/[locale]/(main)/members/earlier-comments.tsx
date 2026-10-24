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

// A list drawn again reads at most this many pages; past them, the button goes on from there.
const MAX_PAGES = 50;

// The comments on a wall post before those a list shows, drawn as the list draws its own (see
// `EarlierComments`). Each comment at or past `beforeId` (the oldest the list shows, when it
// starts from the newest) is left out. The comment cursors name an id, so a page read from one
// stays right whatever was written or deleted above it.
// - A press (`through` null) reads one page from `cursor` (null: from `from`, or the newest).
// - The list drawn again (`through`: the oldest comment loaded) reads from the start down to that
//   comment and keeps nothing older, so the loaded comments match the page again; the next press
//   then reads on from the page it stopped in (a comment read twice is drawn once).
export async function earlierComments(
  profilePostId: number,
  profileUserId: number,
  beforeId: number | null,
  from: string | null,
  cursor: string | null,
  through: number | null,
): Promise<EarlierPage> {
  requireIds(profilePostId, profileUserId);
  if (beforeId !== null) requireIds(beforeId);
  if (through !== null) requireIds(through);
  for (const text of [from, cursor])
    if (text !== null && typeof text !== "string")
      throw new SermoError("validation", 422, "Not a cursor.");
  const [viewer, reactionTypes] = await Promise.all([
    getViewer(),
    getReactionTypes(),
  ]);
  const read: ApiWallComment[] = [];
  // Where the next press reads from, and whether the list has no more.
  let at = through === null ? (cursor ?? from) : from;
  let done = false;
  for (let pages = 0; pages < MAX_PAGES; pages += 1) {
    const page = await call(profileCommentsList, {
      profilePostId,
      cursor: at ?? undefined,
    });
    const kept = page.items.filter(
      (comment) => through === null || comment.id >= through,
    );
    read.push(...kept);
    if (through !== null && kept.length < page.items.length) break;
    at = page.nextCursor;
    done = at === null;
    if (done || through === null || kept.some((c) => c.id === through)) break;
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
    mayUndelete: viewer.resolvedPermissions["profilePost.undelete"] === true,
  };
  return {
    rows: oldestFirst(comments).map((comment) => ({
      id: comment.id,
      node: <WallCommentRows comments={[comment]} {...rows} />,
    })),
    cursor: at,
    done,
  };
}
