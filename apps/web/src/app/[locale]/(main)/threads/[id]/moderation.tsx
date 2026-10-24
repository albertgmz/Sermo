import { nodesList, type threadsGet } from "@sermo/core/contracts";
import { ListChecks } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type * as z from "zod";
import { MergeControl } from "@/app/[locale]/(main)/threads/[id]/merge-control";
import {
  mayRestore,
  type ThreadMay,
} from "@/app/[locale]/(main)/threads/[id]/permissions";
import {
  deleteThreadAction,
  mergeThreadAction,
  moveThreadAction,
  previewMergeAction,
  removeCoverAction,
  restoreThreadAction,
  setFeaturedAction,
  setLockedAction,
  setStickyAction,
  splitThreadAction,
} from "@/app/[locale]/(main)/threads/actions";
import { ActionForm } from "@/components/forum/action-form";
import { DeleteControl } from "@/components/forum/delete-control";
import { DeleteDialog } from "@/components/forum/delete-dialog";
import { deleteMode } from "@/components/forum/delete-mode";
import { type ForumOption, ForumPicker } from "@/components/forum/forum-picker";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { read } from "@/lib/sermo/client";
import { cn } from "@/lib/utils";

export const SPLIT_FORM = "split-form";

type Thread = z.output<typeof threadsGet.output>["thread"];

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium">{title}</h3>
      {children}
    </section>
  );
}

// The forums a picker offers, as only what it shows: a forum's icon and cover are pictures and
// must not travel to the browser through a client component's props (LITE mode).
export function forumOptions(
  items: z.output<typeof nodesList.output>["items"],
  except?: number,
): ForumOption[] {
  return items
    .filter((node) => node.type === "forum" && node.id !== except)
    .map(({ id, title, depth }) => ({ id, title, depth }));
}

// The forums the backend lists, apart from the one the thread is in.
export async function forumsOtherThan(nodeId: number) {
  const { items } = await read(nodesList, {});
  return forumOptions(items, nodeId);
}

// Everything a moderator can do to the thread as a whole, in one panel that the thread's "•••" menu
// opens under its action row (open from the start while posts are being picked for a split). The
// caller draws it only when at least one item applies.
export async function ModerationPanel({
  thread,
  may,
  mayRemoveCover,
  staffPick,
  selecting,
}: {
  thread: Thread;
  may: ThreadMay;
  mayRemoveCover: boolean;
  staffPick: boolean;
  selecting: boolean;
}) {
  const [t, forums] = await Promise.all([
    getTranslations("threads.moderation"),
    may.move ? forumsOtherThan(thread.nodeId) : Promise.resolve([]),
  ]);
  const id = thread.id;
  // Only a visible thread can be featured; a pick that is already made can always be ended.
  const mayFeature = may.feature && (staffPick || thread.state === "visible");
  const removal = deleteMode(
    {
      state: thread.state,
      canDelete: may.delete,
      canHardDelete: may.hardDelete,
    },
    may.hardDeleteAny,
  );
  return (
    <section
      aria-label={t("menu")}
      className="space-y-4 rounded-lg border bg-card p-3"
    >
      {(may.stick || mayFeature || may.lock || mayRemoveCover) && (
        <div className="flex flex-wrap gap-2">
          {may.stick && (
            <ActionForm
              action={setStickyAction.bind(null, id, !thread.isSticky)}
              submit={thread.isSticky ? t("unstick") : t("stick")}
            />
          )}
          {mayFeature && (
            <ActionForm
              action={setFeaturedAction.bind(null, id, !staffPick)}
              submit={staffPick ? t("unfeature") : t("feature")}
            />
          )}
          {may.lock && (
            <ActionForm
              action={setLockedAction.bind(null, id, !thread.isLocked)}
              submit={thread.isLocked ? t("unlock") : t("lock")}
            />
          )}
          {mayRemoveCover && (
            <DeleteControl
              action={removeCoverAction.bind(null, id)}
              label={t("removeCover")}
              confirm={t("removeCoverConfirm")}
              cancel={t("cancel")}
              warning={t("removeCoverWarning")}
            />
          )}
        </div>
      )}

      {may.move && forums.length > 0 && (
        <Section title={t("moveHeading")}>
          <DeleteControl
            action={moveThreadAction.bind(null, id)}
            label={t("move")}
            confirm={t("moveConfirm")}
            cancel={t("cancel")}
            variant="outline"
          >
            <Label id="move-forum" className="sr-only">
              {t("moveLabel")}
            </Label>
            <ForumPicker
              name="nodeId"
              forums={forums}
              labelledBy="move-forum"
              placeholder={t("movePlaceholder")}
            />
          </DeleteControl>
        </Section>
      )}

      {may.merge && (
        <Section title={t("mergeHeading")}>
          <MergeControl
            preview={previewMergeAction.bind(null, id)}
            merge={mergeThreadAction.bind(null, id)}
          />
        </Section>
      )}

      {may.split && (
        <Section title={t("splitHeading")}>
          <p className="text-sm text-muted-foreground">{t("splitHint")}</p>
          <Link
            href={selecting ? `/threads/${id}` : `/threads/${id}?select=1`}
            className={cn(buttonVariants({ variant: "outline" }), "h-10 px-3")}
          >
            <ListChecks aria-hidden="true" />
            {selecting ? t("selectDone") : t("select")}
          </Link>
        </Section>
      )}

      {(removal.show || mayRestore(may, thread.state)) && (
        <Section title={t("stateHeading")}>
          {mayRestore(may, thread.state) && (
            <ActionForm
              action={restoreThreadAction.bind(null, id)}
              submit={
                thread.state === "moderated" ? t("approve") : t("restore")
              }
            />
          )}
          {removal.show && (
            <DeleteDialog
              action={deleteThreadAction.bind(null, id)}
              permanent={removal.permanent}
              label={removal.permanent === "only" ? undefined : t("delete")}
              confirm={
                removal.permanent === "only"
                  ? t("hardDeleteConfirm")
                  : t("confirmDelete")
              }
              permanentHint={t("hardDeleteWarning")}
            />
          )}
        </Section>
      )}
    </section>
  );
}

// The form that takes the posts ticked in the thread into a new thread. The ticks sit on the posts
// themselves and reach this form through its id.
export async function SplitPanel({ thread }: { thread: Thread }) {
  const [t, { items }] = await Promise.all([
    getTranslations("threads.moderation"),
    read(nodesList, {}),
  ]);
  const forums = forumOptions(items);
  return (
    <section
      aria-label={t("splitHeading")}
      className="mt-3 space-y-3 rounded-lg border bg-card p-3"
    >
      <p className="text-sm text-muted-foreground">{t("splitTick")}</p>
      <DeleteControl
        id={SPLIT_FORM}
        action={splitThreadAction.bind(null, thread.id)}
        label={t("split")}
        confirm={t("splitConfirm")}
        cancel={t("cancel")}
        reasonLabel={t("reason")}
        variant="outline"
      >
        <Label htmlFor="split-title" className="text-muted-foreground">
          {t("splitTitle")}
        </Label>
        <Input id="split-title" name="title" required />
        <Label id="split-forum" className="text-muted-foreground">
          {t("splitForum")}
        </Label>
        <ForumPicker
          name="nodeId"
          forums={forums}
          labelledBy="split-forum"
          placeholder={t("movePlaceholder")}
          defaultValue={thread.nodeId}
        />
      </DeleteControl>
      <Link
        href={`/threads/${thread.id}`}
        className={cn(buttonVariants({ variant: "ghost" }), "h-10 px-3")}
      >
        {t("selectDone")}
      </Link>
    </section>
  );
}
