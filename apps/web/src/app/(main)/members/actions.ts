"use server";

import {
  profileCommentsCreate,
  profilePostsCreate,
  usersFollow,
  usersUnfollow,
} from "@sermo/core/contracts";
import { redirect } from "next/navigation";
import { call } from "@/lib/sermo/client";
import { formIds, requireIds } from "@/lib/sermo/ids";
import { attempt } from "@/lib/sermo/outcome";
import { safeReturnPath } from "@/lib/sermo/return-path";

export type WallState = { error?: string };

// Posts on the wall of `profileUserId` and goes back to the page the form was on.
export async function postToWall(
  profileUserId: number,
  returnTo: string,
  _previous: WallState,
  formData: FormData,
): Promise<WallState> {
  requireIds(profileUserId);
  const body = String(formData.get("body") ?? "");
  const attachmentIds = formIds(formData, "attachmentIds");
  const created = await attempt(returnTo, () =>
    call(profilePostsCreate, { userId: profileUserId, body, attachmentIds }),
  );
  if (!created.ok) return { error: created.error };
  redirect(safeReturnPath(returnTo));
}

export async function commentOnWallPost(
  profilePostId: number,
  returnTo: string,
  _previous: WallState,
  formData: FormData,
): Promise<WallState> {
  requireIds(profilePostId);
  const body = String(formData.get("body") ?? "");
  const created = await attempt(returnTo, () =>
    call(profileCommentsCreate, { profilePostId, body }),
  );
  if (!created.ok) return { error: created.error };
  redirect(safeReturnPath(returnTo));
}

// The form says which state it wants (`following` is "true" or "false"), so a second click on a
// stale page cannot flip it back.
export async function setFollowing(
  userId: number,
  returnTo: string,
  _previous: WallState,
  formData: FormData,
): Promise<WallState> {
  requireIds(userId);
  const follow = formData.get("following") === "true";
  const done = await attempt(returnTo, async () => {
    if (follow) await call(usersFollow, { userId });
    else await call(usersUnfollow, { userId });
  });
  if (!done.ok) return { error: done.error };
  redirect(safeReturnPath(returnTo));
}
