import type { threadsGet } from "@sermo/core/contracts";
import { Bell, BellOff } from "lucide-react";
import { getTranslations } from "next-intl/server";
import type * as z from "zod";
import { EditThreadButton } from "@/app/[locale]/(main)/threads/[id]/edit-thread-button";
import { ModerationMenu } from "@/app/[locale]/(main)/threads/[id]/moderation";
import type { ThreadMay } from "@/app/[locale]/(main)/threads/[id]/permissions";
import {
  unwatchThreadAction,
  watchThreadAction,
} from "@/app/[locale]/(main)/threads/actions";
import { ActionForm } from "@/components/forum/action-form";
import { BookmarkButton } from "@/components/forum/bookmark-button";
import { Label } from "@/components/ui/label";

type Found = z.output<typeof threadsGet.output>;
type Thread = Found["thread"];

// The row of buttons under the title: watching and bookmarking, for any signed-in member, "Edit
// thread" for its author and the moderators (`canEditTitle`), and the moderation menu for those it
// applies to. Whether the member watches the thread comes with it (`threads.get`).
export async function ThreadTools({
  thread,
  watching,
  bookmarked,
  canWatch,
  canEditTitle,
  may,
  mayRemoveCover,
  staffPick,
  selecting,
}: {
  thread: Thread;
  watching: Found["watching"];
  // Null when the bookmark state could not be read: no toggle is drawn.
  bookmarked: boolean | null;
  canWatch: boolean;
  canEditTitle: boolean;
  may: ThreadMay;
  mayRemoveCover: boolean;
  // A moderator has picked the thread: the menu offers to end the pick.
  staffPick: boolean;
  selecting: boolean;
}) {
  const t = await getTranslations("threads.tools");
  const moderate = may.any || mayRemoveCover;
  return (
    <div className="mt-3 flex flex-wrap items-start gap-2">
      {watching ? (
        <ActionForm
          action={unwatchThreadAction.bind(null, thread.id)}
          submit={
            <>
              <BellOff aria-hidden="true" />
              {t("unwatch")}
            </>
          }
        />
      ) : (
        canWatch && (
          <ActionForm
            action={watchThreadAction.bind(null, thread.id)}
            className="flex flex-wrap items-center gap-x-3 space-y-0"
            submit={
              <>
                <Bell aria-hidden="true" />
                {t("watch")}
              </>
            }
          >
            <Label className="min-h-10 text-sm font-normal text-muted-foreground">
              <input
                type="checkbox"
                name="email"
                className="size-4 accent-primary"
              />
              {t("email")}
            </Label>
          </ActionForm>
        )
      )}
      {bookmarked !== null && (
        <BookmarkButton
          contentType="thread"
          contentId={thread.id}
          bookmarked={bookmarked}
        />
      )}
      {canEditTitle && (
        <EditThreadButton
          threadId={thread.id}
          href={`/threads/${thread.id}/edit/${thread.firstPostId}`}
        />
      )}
      {moderate && (
        <ModerationMenu
          thread={thread}
          may={may}
          mayRemoveCover={mayRemoveCover}
          staffPick={staffPick}
          selecting={selecting}
        />
      )}
    </div>
  );
}
