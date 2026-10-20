import { threadsGet } from "@sermo/core/contracts";
import { notFound, redirect } from "next/navigation";
import { threadHref } from "@/app/[locale]/(main)/threads/[id]/pages";
import { read } from "@/lib/sermo/client";
import { parsePageId } from "@/lib/sermo/ids";

// A thread's newest post, at the page that holds it (the old forum's `/latest`). A page load is
// settled by the proxy; this page answers a soft navigation.
export default async function ThreadLatestPage({
  params,
}: PageProps<"/[locale]/threads/[id]/latest">) {
  const threadId = parsePageId((await params).id);
  if (threadId === null) notFound();
  const { thread } = await read(threadsGet, { threadId, countView: false });
  redirect(
    threadHref(thread.id, thread.lastPost.position, thread.lastPost.postId),
  );
}
