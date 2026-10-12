import { cache } from "react";
import { getPosts, type ThreadView } from "@/lib/db";
import { stripMarkdownImages } from "@/lib/lite-markdown";
import { getLiteOrigin, getLiteState } from "@/lib/lite-mode";

const withoutImages = cache(async (threadId: number) => {
  const [post] = await getPosts(threadId, null);
  const [state, origin] = await Promise.all([getLiteState(), getLiteOrigin()]);
  const text = stripMarkdownImages(post?.body ?? "", state, origin)
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
  // The stored excerpt only drops inline pictures; any blocked category may
  // hide a picture it still names (reference style, raw HTML), so filter then.
  const { master, blocked } = await getLiteState();
  return master || blocked.length > 0
    ? withoutImages(thread.id)
    : thread.excerpt;
}
