"use server";

import {
  profileCommentsCreate,
  profileCommentsDelete,
  profileCommentsGet,
  profileCommentsUpdate,
  profilePostsCreate,
  profilePostsDelete,
  profilePostsGet,
  profilePostsUpdate,
  usersFollow,
  usersUnfollow,
} from "@sermo/core/contracts";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { call } from "@/lib/sermo/client";
import { SermoError } from "@/lib/sermo/errors";
import { formIds, requireIds } from "@/lib/sermo/ids";
import { attempt } from "@/lib/sermo/outcome";
import { safeReturnPath } from "@/lib/sermo/return-path";

export type WallState = { error?: string; done?: boolean };

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

// Comments on a wall post and goes back to the page the form was on: the wall, or the feed. That
// address can differ from the one in the browser by its hash alone (the comment count leads to
// the composer), which is no navigation to the server, so the page is refreshed first.
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
  refresh();
  redirect(safeReturnPath(returnTo));
}

// A wall post or a comment on one: the same actions on both.
export type WallItemKind = "post" | "comment";

const isKind = (kind: string): kind is WallItemKind =>
  kind === "post" || kind === "comment";

// The Markdown a wall post or comment was written in, for editing it in place: the lists only carry
// rendered text. Nothing when the backend refuses, and the form says so.
export async function wallItemSource(
  kind: WallItemKind,
  id: number,
): Promise<string | null> {
  if (!isKind(kind)) return null;
  requireIds(id);
  try {
    const found =
      kind === "post"
        ? await call(profilePostsGet, { profilePostId: id })
        : await call(profileCommentsGet, { commentId: id });
    return found.bodySource;
  } catch (error) {
    if (!(error instanceof SermoError)) throw error;
    return null;
  }
}

// Saves an edited wall post or comment and draws the page again; `done` closes the edit form. A post's files stay as they are.
export async function editWallItem(
  kind: WallItemKind,
  id: number,
  _previous: WallState,
  formData: FormData,
): Promise<WallState> {
  if (!isKind(kind)) return {};
  requireIds(id);
  const body = String(formData.get("body") ?? "");
  const saved = await attempt("/", async () => {
    if (kind === "post")
      await call(profilePostsUpdate, { profilePostId: id, body });
    else await call(profileCommentsUpdate, { commentId: id, body });
  });
  if (!saved.ok) return { error: saved.error };
  refresh();
  return { done: true };
}

// Deletes a wall post or comment (the author, the wall's owner or a moderator, as the backend
// allows) and draws the page again.
export async function deleteWallItem(
  kind: WallItemKind,
  id: number,
  _previous: WallState,
  formData: FormData,
): Promise<WallState> {
  if (!isKind(kind)) return {};
  requireIds(id);
  const reason = String(formData.get("reason") ?? "");
  const deleted = await attempt("/", async () => {
    if (kind === "post")
      await call(profilePostsDelete, { profilePostId: id, reason });
    else await call(profileCommentsDelete, { commentId: id, reason });
  });
  if (!deleted.ok) return { error: deleted.error };
  refresh();
  return {};
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
