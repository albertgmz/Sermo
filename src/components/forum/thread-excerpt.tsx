import { cache } from "react";
import { getPosts, type ThreadView } from "@/lib/db";
import { stripMarkdownImages } from "@/lib/lite-markdown";
import { liteBlocks } from "@/lib/lite-mode";

const withoutImages = cache(async (threadId: number) => {
  const [post] = await getPosts(threadId, null);
  const text = stripMarkdownImages(post?.body ?? "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, "")
    .replace(/[*_~`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= 180) return text;
  const cut = text.lastIndexOf(" ", 180);
  return `${text.slice(0, cut > 0 ? cut : 180)}…`;
});

export async function ThreadExcerpt({
  thread,
}: {
  thread: Pick<ThreadView, "id" | "excerpt">;
}) {
  return (await liteBlocks("postImages"))
    ? withoutImages(thread.id)
    : thread.excerpt;
}
