import { profileCommentsGet, profilePostsGet } from "@sermo/core/contracts";
import { notFound, redirect } from "next/navigation";
import { wallTargetHref } from "@/app/[locale]/(main)/members/[id]/wall-target";
import { read } from "@/lib/sermo/client";
import { SermoError } from "@/lib/sermo/errors";
import { parseId } from "@/lib/sermo/ids";

// A comment on a wall post goes to the wall that holds its post, which shows the comment among
// the post's comments and brings it into view (see the wall post's page next door).
export default async function ProfileCommentPage({
  params,
}: PageProps<"/[locale]/profile-comments/[id]">) {
  const commentId = parseId((await params).id);
  if (commentId === null) notFound();
  try {
    const comment = await read(profileCommentsGet, { commentId });
    const post = await read(profilePostsGet, {
      profilePostId: comment.profilePostId,
    });
    redirect(wallTargetHref(post.profileUserId, post.id, comment.id));
  } catch (error) {
    if (error instanceof SermoError && error.code === "forbidden") notFound();
    throw error;
  }
}
