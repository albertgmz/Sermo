import type { threadsGet } from "@sermo/core/contracts";
import { Bell, BellOff } from "lucide-react";
import { getTranslations } from "next-intl/server";
import type * as z from "zod";
import { ModerationMenu } from "@/app/[locale]/(main)/threads/[id]/moderation";
import type { ThreadMay } from "@/app/[locale]/(main)/threads/[id]/permissions";
import {
  unwatchThreadAction,
  watchThreadAction,
} from "@/app/[locale]/(main)/threads/actions";
import { ActionForm } from "@/components/forum/action-form";
import { Label } from "@/components/ui/label";

type Found = z.output<typeof threadsGet.output>;
type Thread = Found["thread"];

// The row of buttons under the title: watching, for any signed-in member, and the moderation menu
// for those it applies to. Whether the member watches the thread comes with it (`threads.get`).
export async function ThreadTools({
  thread,
  watching,
  canWatch,
  may,
  mayRemoveCover,
  selecting,
}: {
  thread: Thread;
  watching: Found["watching"];
  canWatch: boolean;
  may: ThreadMay;
  mayRemoveCover: boolean;
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
