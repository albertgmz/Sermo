"use server";

import { profileCommentsList } from "@sermo/core/contracts";
import type { EarlierPage } from "@/components/forum/earlier-comments";
import { WallCommentRows } from "@/components/forum/wall-comments";
import { call } from "@/lib/sermo/client";
import { SermoError } from "@/lib/sermo/errors";
import { requireIds } from "@/lib/sermo/ids";
import { membersFor } from "@/lib/sermo/members";
import { getReactionTypes, pickerTypes } from "@/lib/sermo/reactions";
import { getViewer } from "@/lib/sermo/session";

// The batch of comments on a wall post before those a list shows, drawn as the list draws its
// own (see `EarlierComments`). `beforeId`: the oldest comment shown, for the first batch, which
// is read from the newest and leaves out those already there; later batches start at `cursor`.
export async function earlierComments(
  profilePostId: number,
  profileUserId: number,
  beforeId: number | null,
  cursor: string | null,
): Promise<EarlierPage> {
  requireIds(profilePostId, profileUserId);
  if (beforeId !== null) requireIds(beforeId);
  if (cursor !== null && typeof cursor !== "string")
    throw new SermoError("validation", 422, "Not a cursor.");
  const [page, viewer, reactionTypes] = await Promise.all([
    call(profileCommentsList, {
      profilePostId,
      cursor: cursor ?? undefined,
    }),
    getViewer(),
    getReactionTypes(),
  ]);
  const comments = page.items.filter(
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
  return {
    rows: (
      <WallCommentRows
        comments={comments}
        profileUserId={profileUserId}
        member={member}
        viewerId={viewer.user?.id ?? null}
        picker={picker}
        reactionTypes={reactionTypes}
        viewList={viewer.resolvedPermissions["reaction.viewList"] !== false}
      />
    ),
    nextCursor: page.nextCursor,
  };
}
