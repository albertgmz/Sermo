import "server-only";

import {
  type mediaList,
  postsGet,
  profilePostsGet,
  threadsGet,
} from "@sermo/core/contracts";
import type * as z from "zod";
import { wallTargetHref } from "@/app/[locale]/(main)/members/[id]/wall-target";
import { threadHref } from "@/app/[locale]/(main)/threads/[id]/pages";
import { type PictureKind, parseRef } from "@/components/forum/picture-ref";
import type {
  GatedUrl,
  GatedWidth,
  PictureEntry,
  PictureResult,
} from "@/components/forum/picture-types";
import { liteBlocks } from "@/lib/lite-mode";
import { call } from "@/lib/sermo/client";
import { SermoError } from "@/lib/sermo/errors";
import {
  getReactionTypes,
  pickerTypes,
  reactionsData,
} from "@/lib/sermo/reactions";
import { getViewer } from "@/lib/sermo/session";

type MediaItem = z.output<typeof mediaList.output>["items"][number];
type Attachment = MediaItem["file"];

// The one place the address of a picture in the viewer meets LITE: with post pictures blocked it
// is dropped here, so nothing after this can send it to the browser.
export function gateUrl(url: string, blocked: boolean): GatedUrl | null {
  return blocked ? null : (url as GatedUrl);
}

// The smaller copies of a picture go with it through the same gate: none when it is blocked.
export function gateWidths(
  widths: Attachment["widths"],
  blocked: boolean,
): GatedWidth[] {
  return blocked
    ? []
    : widths.map((copy) => ({ url: copy.url as GatedUrl, width: copy.width }));
}

export const picturesBlocked = () => liteBlocks("postImages");

// The viewer's record of one picture of the media list.
export function pictureEntry(
  item: MediaItem,
  label: string,
  blocked: boolean,
): PictureEntry {
  return {
    id: item.id,
    ref:
      item.type === "post"
        ? { kind: "post", contentId: item.postId, fileId: item.file.fileId }
        : {
            kind: "wall",
            contentId: item.profilePostId,
            fileId: item.file.fileId,
          },
    url: gateUrl(item.file.url, blocked),
    width: item.file.width,
    height: item.file.height,
    widths: gateWidths(item.file.widths, blocked),
    label,
  };
}

// What a refusal of these reads means for the viewer: the picture is no longer there for this
// visitor (deleted, moved, closed to them, a session that ended). Anything else may pass.
const GONE = ["not_found", "forbidden", "unauthenticated", "validation"];

// The kinds of file `media.list` lists as pictures; a file of another kind is not shown here either.
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

function pictureOf(
  attachments: Attachment[],
  fileId: number,
  blocked: boolean,
) {
  const file = attachments.find(
    (attachment) =>
      attachment.fileId === fileId &&
      IMAGE_TYPES.includes(attachment.contentType),
  );
  return (
    file && {
      url: gateUrl(file.url, blocked),
      width: file.width,
      height: file.height,
      widths: gateWidths(file.widths, blocked),
    }
  );
}

// The details of one picture, asked for when the viewer opens it, through the reads a page of the
// post makes: nothing is carried by the list. The post or wall post must be visible, and the file
// one of its pictures; otherwise the answer is `gone`.
export async function pictureDetails(
  kind: PictureKind,
  contentId: number,
  fileId: number,
): Promise<PictureResult> {
  // An action's arguments come from the browser: only what an address could say is taken.
  if (!parseRef(`${kind}-${contentId}-${fileId}`)) return { status: "gone" };
  try {
    return kind === "post"
      ? await postDetails(contentId, fileId)
      : await wallDetails(contentId, fileId);
  } catch (error) {
    if (!(error instanceof SermoError)) throw error;
    return { status: GONE.includes(error.code) ? "gone" : "failed" };
  }
}

async function postDetails(
  postId: number,
  fileId: number,
): Promise<PictureResult> {
  const post = await call(postsGet, { postId });
  const [thread, viewer, types, blocked] = await Promise.all([
    // Opening a picture is not reading the thread: no view is counted.
    call(threadsGet, { threadId: post.threadId, countView: false }),
    getViewer(),
    getReactionTypes(),
    picturesBlocked(),
  ]);
  const picture = pictureOf(post.attachments, fileId, blocked);
  if (post.state !== "visible" || thread.thread.state !== "visible" || !picture)
    return { status: "gone" };
  const picker =
    post.canReact && viewer.permissions.canReact
      ? pickerTypes(types, thread.thread.node.id)
      : [];
  return {
    status: "ready",
    details: {
      author: { id: post.author.id, username: post.author.username },
      createdAt: post.createdAt,
      where: {
        href: threadHref(post.threadId, post.position, post.id),
        label: thread.thread.title,
      },
      picture,
      viewerId: viewer.user?.id ?? null,
      reactions: reactionsData(
        { target: "post", id: post.id, authorId: post.author.id },
        post.reactions,
        picker,
        types,
        viewer.resolvedPermissions["reaction.viewList"] !== false,
      ),
      reply:
        viewer.user && thread.permissions.canReply
          ? { kind: "post", threadId: post.threadId }
          : null,
    },
  };
}

async function wallDetails(
  profilePostId: number,
  fileId: number,
): Promise<PictureResult> {
  const post = await call(profilePostsGet, { profilePostId });
  const [viewer, types, blocked] = await Promise.all([
    getViewer(),
    getReactionTypes(),
    picturesBlocked(),
  ]);
  const picture = pictureOf(post.attachments, fileId, blocked);
  if (post.state !== "visible" || !picture) return { status: "gone" };
  // Wall posts are reacted to with `profilePost.react`.
  const mayReact = viewer.resolvedPermissions["profilePost.react"] !== false;
  const picker =
    mayReact && viewer.permissions.canReact ? pickerTypes(types, null) : [];
  return {
    status: "ready",
    details: {
      author: { id: post.author.id, username: post.author.username },
      createdAt: post.createdAt,
      where: {
        href: wallTargetHref(post.profileUserId, post.id),
        label: null,
      },
      picture,
      viewerId: viewer.user?.id ?? null,
      reactions: reactionsData(
        { target: "profilePost", id: post.id, authorId: post.author.id },
        post.reactions,
        picker,
        types,
        viewer.resolvedPermissions["reaction.viewList"] !== false,
      ),
      reply:
        viewer.user && post.canComment
          ? { kind: "wall", profilePostId: post.id }
          : null,
    },
  };
}
