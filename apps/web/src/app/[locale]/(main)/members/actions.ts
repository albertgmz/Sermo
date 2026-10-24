"use server";

import {
  profileCommentsCreate,
  profileCommentsDelete,
  profileCommentsGet,
  profileCommentsHardDelete,
  profileCommentsRestore,
  profileCommentsUpdate,
  profilePostsCreate,
  profilePostsDelete,
  profilePostsGet,
  profilePostsHardDelete,
  profilePostsRestore,
  profilePostsUpdate,
  usersFollow,
  usersUnfollow,
} from "@sermo/core/contracts";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { wallTargetHref } from "@/app/[locale]/(main)/members/[id]/wall-target";
import { call } from "@/lib/sermo/client";
import { eraseHidingFirst } from "@/lib/sermo/erase";
import { SermoError } from "@/lib/sermo/errors";
import { formIds, requireIds } from "@/lib/sermo/ids";
import { attempt } from "@/lib/sermo/outcome";
import { pageOfRequest } from "@/lib/sermo/request-page";
import { safeReturnPath } from "@/lib/sermo/return-path";

export type WallState = { error?: string; done?: boolean };

// Posts on the wall of `profileUserId` and goes back to the page the form was on: on that wall,
// to its first page at the new post, which the page lands on.
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
  const back = safeReturnPath(returnTo);
  redirect(
    back === `/members/${profileUserId}` ||
      back.startsWith(`/members/${profileUserId}?`)
      ? wallTargetHref(profileUserId, created.value.id)
      : back,
  );
}

// Comments on a wall post, and the page lands on the new comment. On the wall (`wall`, the id of
// its member) it goes to the wall at the comment, which opens the page that holds it whatever the
// wall showed. Elsewhere (the feed, a picture's viewer) the page is drawn again where it is and
// the composer lands on the comment (`landOn`): a redirect to the same address would only change
// its hash, which the router answers by scrolling to the top of the page.
export async function commentOnWallPost(
  profilePostId: number,
  wall: number | undefined,
  _previous: WallState,
  formData: FormData,
): Promise<WallState & { landOn?: string }> {
  requireIds(profilePostId);
  if (wall !== undefined) requireIds(wall);
  const body = String(formData.get("body") ?? "");
  const attachmentIds = formIds(formData, "attachmentIds");
  const page =
    wall === undefined
      ? await pageOfRequest()
      : wallTargetHref(wall, profilePostId);
  const created = await attempt(page, () =>
    call(profileCommentsCreate, { profilePostId, body, attachmentIds }),
  );
  if (!created.ok) return { error: created.error };
  if (wall !== undefined)
    redirect(wallTargetHref(wall, profilePostId, created.value.id));
  refresh();
  return { landOn: `#profile-comment-${created.value.id}` };
}

// A wall post or a comment on one: the same actions on both.
export type WallItemKind = "post" | "comment";

const isKind = (kind: string): kind is WallItemKind =>
  kind === "post" || kind === "comment";

// The BB code a wall post or comment was written in, for editing it in place: the lists only carry
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

// Saves an edited wall post or comment and draws the page again; `done` closes the edit form. Its files stay as they are.
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
  if (formData.get("hardDelete") === "1")
    return kind === "post"
      ? hardDeleteWallPost(id, _previous, formData)
      : hardDeleteWallComment(id, formData);
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

// Brings back a deleted wall post or comment (a moderator, as the backend allows) and draws the
// page again.
export async function restoreWallItem(
  kind: WallItemKind,
  id: number,
  _previous: WallState,
): Promise<WallState> {
  if (!isKind(kind)) return {};
  requireIds(id);
  const restored = await attempt("/", async () => {
    if (kind === "post") await call(profilePostsRestore, { profilePostId: id });
    else await call(profileCommentsRestore, { commentId: id });
  });
  if (!restored.ok) return { error: restored.error };
  refresh();
  return {};
}

// Erases a wall post and its comments for good (a live one is hidden first). The backend does a
// large wall in steps of 500 comments, one call each; one request makes at most this many calls
// and the button can be pressed again to go on.
const HARD_DELETE_CALLS = 20;
export async function hardDeleteWallPost(
  id: number,
  _previous: WallState,
  formData: FormData,
): Promise<WallState> {
  requireIds(id);
  const reason = String(formData.get("reason") ?? "");
  for (let step = 0; step < HARD_DELETE_CALLS; step++) {
    const erased = await attempt("/", () =>
      eraseHidingFirst(
        () => call(profilePostsHardDelete, { profilePostId: id, reason }),
        async () => {
          const { state } = await call(profilePostsGet, { profilePostId: id });
          if (state === "deleted") return false;
          await call(profilePostsDelete, {
            profilePostId: id,
            reason,
            notify: false,
          });
          return true;
        },
      ),
    );
    if (!erased.ok) return { error: erased.error };
    if (erased.value.completed) {
      refresh();
      return {};
    }
  }
  refresh();
  return {
    error: (await getTranslations("threads.moderation"))("hardDeleteMore"),
  };
}

// Erases a wall comment for good (a live one is hidden first).
async function hardDeleteWallComment(
  id: number,
  formData: FormData,
): Promise<WallState> {
  const reason = String(formData.get("reason") ?? "");
  const erased = await attempt("/", () =>
    eraseHidingFirst(
      () => call(profileCommentsHardDelete, { commentId: id, reason }),
      async () => {
        const { state } = await call(profileCommentsGet, { commentId: id });
        if (state === "deleted") return false;
        await call(profileCommentsDelete, {
          commentId: id,
          reason,
          notify: false,
        });
        return true;
      },
    ),
  );
  if (!erased.ok) return { error: erased.error };
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
