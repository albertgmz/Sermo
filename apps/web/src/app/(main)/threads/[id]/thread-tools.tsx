import type { threadsGet } from "@sermo/core/contracts";
import { Bell, BellOff } from "lucide-react";
import { getTranslations } from "next-intl/server";
import type * as z from "zod";
import { ModerationMenu } from "@/app/(main)/threads/[id]/moderation";
import type { ThreadMay } from "@/app/(main)/threads/[id]/permissions";
import {
  unwatchThreadAction,
  watchThreadAction,
} from "@/app/(main)/threads/actions";
import { ActionForm } from "@/components/forum/action-form";
import { Label } from "@/components/ui/label";
import { threadWatch } from "@/lib/watching";

type Thread = z.output<typeof threadsGet.output>["thread"];

// The row of buttons under the title: watching, for any signed-in member, and the moderation menu
// for those it applies to. It settles after the posts, as the watch state is a separate read.
export async function ThreadTools({
  thread,
  may,
  mayRemoveCover,
  selecting,
}: {
  thread: Thread;
  may: ThreadMay;
  mayRemoveCover: boolean;
  selecting: boolean;
}) {
  const [t, watch] = await Promise.all([
    getTranslations("threads.tools"),
    threadWatch(thread.id),
  ]);
  const moderate = may.any || mayRemoveCover;
  return (
    <div className="mt-3 flex flex-wrap items-start gap-2">
      {watch ? (
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
      )}
      {moderate && (
        <ModerationMenu
          thread={thread}
          may={may}
          mayRemoveCover={mayRemoveCover}
          selecting={selecting}
        />
      )}
    </div>
  );
}
