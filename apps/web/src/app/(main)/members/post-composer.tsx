"use client";

import { ImagePlus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { findRecipients } from "@/app/(main)/conversations/actions";
import type { WallState } from "@/app/(main)/members/actions";
import { AttachmentField } from "@/components/forum/attachment-field";
import { FormError } from "@/components/forum/form-error";
import { LazyEditor } from "@/components/forum/lazy-editor";
import { messageActionClass } from "@/components/forum/message-action";
import { useKeptForm } from "@/components/forum/use-kept-form";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

// The composer of a wall post. On the page it is a line: the avatar, a pill that opens the
// composer and a button that opens it on choosing a file; none of it loads the editor. Opened, it
// fills a phone's screen and is a centred dialog from `md` up: close and post at the top, the
// text, and one bar of tools at the bottom (files, then the editor's formatting bar).
//
// The composer stays in the page while it is closed, so closing it loses nothing: the text and
// the files are there when it is opened again. A refused post keeps them too.
export function PostComposer({
  action,
  placeholder,
  avatar,
  name,
  className,
}: {
  action: (previous: WallState, formData: FormData) => Promise<WallState>;
  placeholder: string;
  // Drawn by the page: the avatar is a Server Component.
  avatar: React.ReactNode;
  name: string;
  className?: string;
}) {
  const t = useTranslations("members.postComposer");
  const { state, pending, onSubmit } = useKeptForm(action);
  const [open, setOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [bar, setBar] = useState<HTMLDivElement | null>(null);
  const [visibleHeight, setVisibleHeight] = useState<number>();
  const form = useRef<HTMLFormElement>(null);

  // A phone's keyboard covers the bottom of the screen without making the page any shorter, so
  // the full-screen composer takes the height that is really in view to keep its bar above it.
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!open || !viewport) return;
    const fit = () => setVisibleHeight(viewport.height);
    fit();
    viewport.addEventListener("resize", fit);
    return () => viewport.removeEventListener("resize", fit);
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <div className={cn("flex items-center gap-2", className)}>
        <div className="mr-1">{avatar}</div>
        <DialogTrigger
          render={
            <button
              type="button"
              className="h-10 min-w-0 flex-1 truncate rounded-full border bg-card px-4 text-left text-base text-muted-foreground transition-colors hover:border-ring md:text-sm"
            />
          }
        >
          {placeholder}
        </DialogTrigger>
        <button
          type="button"
          aria-label={t("aria.attach")}
          title={t("aria.attach")}
          className={cn(messageActionClass, "size-10 shrink-0 px-0 md:size-10")}
          onClick={() => {
            setOpen(true);
            // The composer's own file field, which is in the page while the composer is closed.
            form.current
              ?.querySelector<HTMLInputElement>('input[type="file"]')
              ?.click();
          }}
        >
          <ImagePlus />
        </button>
      </div>
      <DialogContent
        keepMounted
        showCloseButton={false}
        initialFocus={() =>
          form.current?.querySelector<HTMLElement>(
            "textarea, [contenteditable]",
          ) ?? null
        }
        style={
          visibleHeight === undefined
            ? undefined
            : ({
                "--visible-height": `${visibleHeight}px`,
              } as React.CSSProperties)
        }
        className="top-0 left-0 flex h-[var(--visible-height,100dvh)] max-h-dvh max-w-none translate-x-0 sm:max-w-none translate-y-0 flex-col gap-0 rounded-none bg-background p-0 md:top-1/2 md:left-1/2 md:h-auto md:max-h-[min(40rem,85dvh)] md:max-w-xl md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-xl"
      >
        <form
          ref={form}
          onSubmit={onSubmit}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="flex items-center justify-between gap-2 border-b p-2">
            <DialogClose
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={t("aria.close")}
                  className="size-10"
                />
              }
            >
              <X />
            </DialogClose>
            <DialogTitle className="sr-only">{t("title")}</DialogTitle>
            <Button
              type="submit"
              disabled={pending || uploading}
              className="h-10 rounded-full px-5"
            >
              {t("post")}
            </Button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="flex items-center gap-3 px-3 pt-3">
              {avatar}
              <span className="truncate text-sm font-semibold">{name}</span>
            </div>
            <LazyEditor
              name="body"
              placeholder={placeholder}
              minHeight={160}
              toolbarContainer={bar}
              findMembers={findRecipients}
              className="rounded-none border-0 bg-transparent"
            />
            {state.error && (
              <FormError className="px-3 pb-3">{state.error}</FormError>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-1 gap-y-2 border-t px-1.5 pt-1 pb-[calc(0.25rem+env(safe-area-inset-bottom))] md:pb-1">
            <AttachmentField compact onBusy={setUploading} />
            <div ref={setBar} className="min-w-0 flex-1" />
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
