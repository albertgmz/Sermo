import { getTranslations } from "next-intl/server";
import { ModerationPanel } from "@/app/[locale]/(main)/threads/[id]/moderation";
import type { PostsContext } from "@/app/[locale]/(main)/threads/[id]/thread-posts";
import { ThreadToolbar } from "@/app/[locale]/(main)/threads/[id]/thread-toolbar";
import { setThreadWatch } from "@/app/[locale]/(main)/threads/actions";
import { BookmarkButton } from "@/components/forum/bookmark-button";
import { WatchButton } from "@/components/forum/watch-button";
import { bookmarkedAmong } from "@/lib/sermo/bookmarks";

// A signed-in member's action row of the thread, as XenForo's: `start` (the pager) on the left; on
// the right "Follow" (its popover holds the email choice), the bookmark, and a "•••" menu with
// "Edit thread" for its author and the moderators (`canEditTitle`), the tags and the poll for
// whoever may change them, and the moderation panel for those it applies to. The watch and
// bookmark buttons are drawn here, on the server, so their props say how old their state is
// (`lib/item-state`). Whether the member watches the thread comes with it (`threads.get`).
export async function ThreadTools({
  context,
  start,
}: {
  context: PostsContext;
  start: React.ReactNode;
}) {
  const { thread, may, selecting, tools } = context;
  if (!tools) return start;
  const [t, bookmarks] = await Promise.all([
    getTranslations("threads.tools"),
    bookmarkedAmong("thread", [thread.id]),
  ]);
  const moderate = may.any || tools.mayRemoveCover;
  // Null when the bookmark state could not be read, or the member may not add one: no toggle.
  const bookmarked = bookmarks ? bookmarks.toggle(thread.id) : null;
  return (
    <ThreadToolbar
      threadId={thread.id}
      start={start}
      watch={
        (tools.watching || tools.canWatch) && (
          <WatchButton
            item={`thread:${thread.id}`}
            watching={
              tools.watching && {
                mode: "threads",
                email: tools.watching.email,
              }
            }
            label={t("watch")}
            save={setThreadWatch.bind(null, thread.id)}
          />
        )
      }
      bookmark={
        bookmarked !== null && (
          <BookmarkButton
            contentType="thread"
            contentId={thread.id}
            bookmarked={bookmarked}
            variant="outline"
          />
        )
      }
      edit={tools.canEditTitle}
      tags={tools.tags}
      poll={tools.addPoll}
      moderation={
        moderate && (
          <ModerationPanel
            thread={thread}
            may={may}
            mayRemoveCover={tools.mayRemoveCover}
            staffPick={tools.staffPick}
            selecting={selecting}
          />
        )
      }
      selecting={selecting}
    />
  );
}
