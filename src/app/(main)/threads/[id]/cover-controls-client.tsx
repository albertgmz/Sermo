"use client";

import { ImagePlus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useActionState } from "react";
import {
  type CoverState,
  changeCover,
  removeCover,
} from "@/app/(main)/threads/actions";
import { PendingButton } from "@/components/forum/pending-button";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const ERRORS = {
  no_cover: "errors.noCover",
  not_found: "errors.notFound",
  not_owned: "errors.notOwned",
  not_author: "errors.notAuthor",
} as const;

const triggerClass = "h-10 px-3 md:h-8";

type OwnedCover = {
  itemId: number;
  name: string;
  preview: React.ReactNode;
  quantity: number;
};

function CoverPicker({
  threadId,
  hasCover,
  covers,
}: {
  threadId: number;
  hasCover: boolean;
  covers: OwnedCover[];
}) {
  const t = useTranslations("threads.coverControlsClient");
  const [state, action] = useActionState<CoverState, FormData>(
    changeCover.bind(null, threadId),
    null,
  );
  return (
    <Dialog>
      <DialogTrigger
        render={<Button variant="outline" className={triggerClass} />}
      >
        <ImagePlus />
        {hasCover ? t("changeLabel") : t("addLabel")}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {hasCover ? t("changeTitle") : t("addTitle")}
          </DialogTitle>
          <DialogDescription>
            {covers.length > 0
              ? t("description", { hasCover: String(hasCover) })
              : t("empty")}
          </DialogDescription>
        </DialogHeader>
        {covers.length > 0 ? (
          <form action={action}>
            <ul className="grid grid-cols-2 gap-2">
              {covers.map((cover) => (
                <li key={cover.itemId}>
                  <PendingButton
                    variant="outline"
                    name="item"
                    value={cover.itemId}
                    aria-label={t("aria.useCover", { name: cover.name })}
                    className="h-auto w-full flex-col items-stretch gap-0 overflow-hidden p-0"
                  >
                    {cover.preview}
                    <span className="flex min-h-10 items-center justify-between gap-2 px-2 text-xs">
                      <span className="truncate">{cover.name}</span>
                      <span className="shrink-0 text-muted-foreground tabular-nums">
                        {t("covers", { count: cover.quantity })}
                      </span>
                    </span>
                  </PendingButton>
                </li>
              ))}
            </ul>
            <output className="mt-2 block text-xs text-destructive empty:hidden">
              {state && t(ERRORS[state.error])}
            </output>
          </form>
        ) : (
          <Link
            href="/credits?category=threadCover"
            className={cn(buttonVariants(), "h-10")}
          >
            {t("browse")}
          </Link>
        )}
      </DialogContent>
    </Dialog>
  );
}

function RemoveCover({ threadId, own }: { threadId: number; own: boolean }) {
  const t = useTranslations("threads.coverControlsClient");
  const [state, action] = useActionState<CoverState, FormData>(
    removeCover.bind(null, threadId),
    null,
  );
  return (
    <Dialog>
      <DialogTrigger
        render={<Button variant="outline" className={triggerClass} />}
      >
        <Trash2 />
        {t("removeLabel")}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("removeTitle")}</DialogTitle>
          <DialogDescription>
            {t("removeDescription", { own: String(own) })}
          </DialogDescription>
        </DialogHeader>
        <form action={action}>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <DialogClose
              render={<Button variant="outline" className="h-10 px-4" />}
            >
              {t("cancel")}
            </DialogClose>
            <PendingButton variant="destructive" className="h-10 px-4">
              {t("removeLabel")}
            </PendingButton>
          </div>
          <output className="mt-2 block text-xs text-destructive empty:hidden">
            {state && t(ERRORS[state.error])}
          </output>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// The author changes or removes the cover; staff can only remove it.
export function CoverControlsClient({
  threadId,
  hasCover,
  own,
  covers,
}: {
  threadId: number;
  hasCover: boolean;
  own: boolean;
  covers: OwnedCover[];
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {own && (
        <CoverPicker threadId={threadId} hasCover={hasCover} covers={covers} />
      )}
      {hasCover && <RemoveCover threadId={threadId} own={own} />}
    </div>
  );
}
