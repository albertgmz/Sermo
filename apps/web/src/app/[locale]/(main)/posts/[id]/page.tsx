import { postsGet } from "@sermo/core/contracts";
import { notFound, permanentRedirect } from "next/navigation";
import { threadHref } from "@/app/[locale]/(main)/threads/[id]/pages";
import { read } from "@/lib/sermo/client";
import { parseId } from "@/lib/sermo/ids";

// A post has no page of its own: its address (the one a quote header links to) goes to the page
// of its thread that holds it, at its anchor. A post the visitor may not see is as missing as an
// id that was never used: the backend answers both with "not found". A page load is settled by
// the proxy, which sets the status; this page answers a soft navigation and a request the proxy
// let through (a backend that could not be asked).
export default async function PostPage({
  params,
}: PageProps<"/[locale]/posts/[id]">) {
  const postId = parseId((await params).id);
  if (postId === null) notFound();
  const post = await read(postsGet, { postId });
  permanentRedirect(threadHref(post.threadId, post.position, post.id));
}
