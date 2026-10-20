import { threadsLocateUnread } from "@sermo/core/contracts";
import { notFound, redirect } from "next/navigation";
import { threadHref } from "@/app/[locale]/(main)/threads/[id]/pages";
import { read } from "@/lib/sermo/client";
import { parsePageId } from "@/lib/sermo/ids";

// Where the reader picks a thread up: its first unread post, or its newest (always for a guest).
// A page load is settled by the proxy; this page answers a soft navigation.
export default async function ThreadUnreadPage({
  params,
}: PageProps<"/[locale]/threads/[id]/unread">) {
  const threadId = parsePageId((await params).id);
  if (threadId === null) notFound();
  const post = await read(threadsLocateUnread, { threadId });
  redirect(threadHref(post.threadId, post.position, post.postId));
}
