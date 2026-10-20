import { profilePostsGet } from "@sermo/core/contracts";
import { notFound, redirect } from "next/navigation";
import { wallTargetHref } from "@/app/[locale]/(main)/members/[id]/wall-target";
import { read } from "@/lib/sermo/client";
import { SermoError } from "@/lib/sermo/errors";
import { parseId } from "@/lib/sermo/ids";

// A wall post has no page of its own: its address (the backend's, and the old forum's after the
// proxy's redirect) goes to the wall that holds it, which shows the post and brings it into view.
// A post the visitor may not see is as missing as an id that was never used. A page load is
// settled by the proxy; this page answers a soft navigation and a request the proxy let through.
export default async function ProfilePostPage({
  params,
}: PageProps<"/[locale]/profile-posts/[id]">) {
  const profilePostId = parseId((await params).id);
  if (profilePostId === null) notFound();
  const post = await read(profilePostsGet, { profilePostId }).catch(
    (error: unknown) => {
      if (error instanceof SermoError && error.code === "forbidden") notFound();
      throw error;
    },
  );
  redirect(wallTargetHref(post.profileUserId, post.id));
}
