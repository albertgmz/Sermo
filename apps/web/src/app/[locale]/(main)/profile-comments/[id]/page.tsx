import { profileCommentsLocate } from "@sermo/core/contracts";
import { notFound, redirect } from "next/navigation";
import { wallTargetHref } from "@/app/[locale]/(main)/members/[id]/wall-target";
import { read } from "@/lib/sermo/client";
import { isAdultRefusal, SermoError } from "@/lib/sermo/errors";
import { parseId } from "@/lib/sermo/ids";

// A comment on a wall post goes to the wall that holds its post, which shows the comment among
// the post's comments and brings it into view (see the wall post's page next door).
export default async function ProfileCommentPage({
  params,
}: PageProps<"/[locale]/profile-comments/[id]">) {
  const commentId = parseId((await params).id);
  if (commentId === null) notFound();
  const comment = await read(profileCommentsLocate, { commentId }).catch(
    (error: unknown) => {
      if (
        error instanceof SermoError &&
        error.code === "forbidden" &&
        !isAdultRefusal(error)
      )
        notFound();
      throw error;
    },
  );
  redirect(
    wallTargetHref(
      comment.profileUserId,
      comment.profilePostId,
      comment.commentId,
    ),
  );
}
