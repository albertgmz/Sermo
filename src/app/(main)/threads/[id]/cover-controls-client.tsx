"use client";

import { ImagePlus, Trash2 } from "lucide-react";
import Link from "next/link";
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
  no_cover: "Choose a cover first.",
  not_found: "This thread or cover no longer exists.",
  not_owned: "You have none of this cover left.",
  not_author: "You cannot change the cover of this thread.",
};

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
        {hasCover ? "Change cover" : "Add cover"}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {hasCover ? "Change the cover" : "Add a cover"}
          </DialogTitle>
          <DialogDescription>
            {covers.length > 0
              ? `Picking a cover uses it up${hasCover ? ", and the current one is not returned" : ""}.`
              : "You have no thread covers. They are sold in the shop, and each one goes on a single thread."}
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
                    aria-label={`Use ${cover.name}`}
                    className="h-auto w-full flex-col items-stretch gap-0 overflow-hidden p-0"
                  >
                    {cover.preview}
                    <span className="flex min-h-10 items-center justify-between gap-2 px-2 text-xs">
                      <span className="truncate">{cover.name}</span>
                      <span className="shrink-0 text-muted-foreground tabular-nums">
                        ×{cover.quantity}
                      </span>
                    </span>
                  </PendingButton>
                </li>
              ))}
            </ul>
            <output className="mt-2 block text-xs text-destructive empty:hidden">
              {state && ERRORS[state.error]}
            </output>
          </form>
        ) : (
          <Link
            href="/credits?category=threadCover"
            className={cn(buttonVariants(), "h-10")}
          >
            Browse thread covers
          </Link>
        )}
      </DialogContent>
    </Dialog>
  );
}

function RemoveCover({ threadId, own }: { threadId: number; own: boolean }) {
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
        Remove cover
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remove the cover?</DialogTitle>
          <DialogDescription>
            {own
              ? "The photo is taken off this thread. It does not go back to your inventory."
              : "The photo is taken off this thread. It does not go back to the author's inventory."}
          </DialogDescription>
        </DialogHeader>
        <form action={action}>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <DialogClose
              render={<Button variant="outline" className="h-10 px-4" />}
            >
              Keep it
            </DialogClose>
            <PendingButton variant="destructive" className="h-10 px-4">
              Remove cover
            </PendingButton>
          </div>
          <output className="mt-2 block text-xs text-destructive empty:hidden">
            {state && ERRORS[state.error]}
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
