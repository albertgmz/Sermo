import { Bell, BellOff } from "lucide-react";
import { getTranslations } from "next-intl/server";
import {
  unwatchForumAction,
  watchForumAction,
} from "@/app/(main)/forums/actions";
import { ActionForm } from "@/components/forum/action-form";
import { Label } from "@/components/ui/label";
import { nodeWatch } from "@/lib/watching";

// Watching a forum: for new threads only or for every new post, and by email if wanted. What the
// member has chosen is read from the backend's list of their watches.
export async function ForumWatch({ nodeId }: { nodeId: number }) {
  const [t, watch] = await Promise.all([
    getTranslations("forums.watch"),
    nodeWatch(nodeId),
  ]);
  if (watch) {
    return (
      <ActionForm
        action={unwatchForumAction.bind(null, nodeId)}
        submit={
          <>
            <BellOff aria-hidden="true" />
            {t("unwatch")}
          </>
        }
      >
        <p className="text-sm text-muted-foreground">
          {t("status", { mode: watch.mode, email: String(watch.email) })}
        </p>
      </ActionForm>
    );
  }
  return (
    <ActionForm
      action={watchForumAction.bind(null, nodeId)}
      submit={
        <>
          <Bell aria-hidden="true" />
          {t("watch")}
        </>
      }
    >
      <fieldset className="flex flex-wrap gap-x-4">
        <legend className="sr-only">{t("mode")}</legend>
        <Label className="min-h-10 text-sm font-normal">
          <input
            type="radio"
            name="mode"
            value="threads"
            defaultChecked
            className="size-4 accent-primary"
          />
          {t("optionThreads")}
        </Label>
        <Label className="min-h-10 text-sm font-normal">
          <input
            type="radio"
            name="mode"
            value="posts"
            className="size-4 accent-primary"
          />
          {t("optionPosts")}
        </Label>
      </fieldset>
      <Label className="min-h-10 text-sm font-normal text-muted-foreground">
        <input type="checkbox" name="email" className="size-4 accent-primary" />
        {t("email")}
      </Label>
    </ActionForm>
  );
}
