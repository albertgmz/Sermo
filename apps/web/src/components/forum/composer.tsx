"use client";

import { X } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { type RefObject, useEffect, useState } from "react";
import { AttachmentField } from "@/components/forum/attachment-field";
import { COMPOSER_PAGE_CLASS } from "@/components/forum/composer-page";
import type { EditorProps } from "@/components/forum/editor";
import { FormError } from "@/components/forum/form-error";
import { LazyEditor } from "@/components/forum/lazy-editor";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  DialogClose,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

// The composer of a post, shared by everything that is written in a sheet: a wall post and a new
// thread. It is a form with close and Post at the top, the text, and one bar of tools at the
// bottom (files, then the editor's formatting bar). The caller puts what is its own above the text
// (`top`); a poll or tags would join the bottom bar here.
//
// Two frames hold it. `ComposerSheet` is a dialog: the whole screen of a phone and a centred box
// from `md` up, or the whole screen at every size (`screen`, the Create button's). `ComposerPage`
// is the same composer as a page, for an address that is visited.
// The form stays in the page while a dialog is closed, so closing loses nothing, and a refused
// post keeps what was written because the caller submits with `useKeptForm`.

const CLOSE = "size-10";

// A phone's keyboard covers the bottom of the screen without making the page any shorter. What is
// really in view is the visual viewport: `height` is its height, `inset` how far the keyboard
// reaches up from the bottom (0 when there is none; the small differences of a browser's own bars
// are not a keyboard).
const KEYBOARD_MIN = 100;

function useVisualViewport(active: boolean) {
  const [view, setView] = useState<{ height?: number; inset: number }>({
    inset: 0,
  });
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!active || !viewport) return;
    const fit = () => {
      const covered = window.innerHeight - viewport.height - viewport.offsetTop;
      const height = viewport.height;
      const inset = covered > KEYBOARD_MIN ? covered : 0;
      // Scroll events fire constantly; a new object each time would redraw the whole form.
      setView((last) =>
        last.height === height && last.inset === inset
          ? last
          : { height, inset },
      );
    };
    fit();
    viewport.addEventListener("resize", fit);
    viewport.addEventListener("scroll", fit);
    return () => {
      viewport.removeEventListener("resize", fit);
      viewport.removeEventListener("scroll", fit);
    };
  }, [active]);
  return view;
}

// Both looks fill a phone's screen to the height that is in view. The sheet becomes a centred box
// from `md` up; the screen stays the whole screen, fades in without growing (nothing of the page
// shows round it) and leaves the column to what it holds. It is part of the forum's layout, so the
// narrower page a visitor chose narrows its column too (`--container-width`, globals.css).
const FILL =
  "top-0 left-0 flex h-[var(--visible-height,100dvh)] max-h-dvh max-w-none translate-x-0 sm:max-w-none translate-y-0 flex-col gap-0 rounded-none bg-background p-0";

export const SHEET_CLASS = {
  sheet: `${FILL} md:top-1/2 md:left-1/2 md:h-auto md:max-h-[min(40rem,85dvh)] md:max-w-xl md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-xl`,
  screen: `${FILL} ring-0 data-open:zoom-in-100 data-closed:zoom-out-100`,
};

export function ComposerSheet({
  open,
  formRef,
  screen = false,
  children,
}: {
  open: boolean;
  formRef?: RefObject<HTMLFormElement | null>;
  // The whole screen at every size.
  screen?: boolean;
  children: React.ReactNode;
}) {
  const { height: visibleHeight } = useVisualViewport(open);
  return (
    <DialogContent
      keepMounted
      showCloseButton={false}
      initialFocus={() =>
        formRef?.current?.querySelector<HTMLElement>(
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
      data-forum-layout={screen ? "" : undefined}
      className={screen ? SHEET_CLASS.screen : SHEET_CLASS.sheet}
    >
      {children}
    </DialogContent>
  );
}

export function ComposerPage({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={cn(COMPOSER_PAGE_CLASS, className)}>{children}</div>;
}

export type ComposerFrame =
  // Inside a `Dialog`: close is the dialog's, and `heading` names it for assistive technology. A
  // dialog that holds several composers names itself once and leaves `heading` out. `grow`: the
  // dialog is the whole screen, and the text takes all of it down to the bar of tools.
  | { kind: "dialog"; heading?: string; grow?: boolean }
  // On a page of its own, which has its own heading: close is a link back.
  | { kind: "page"; closeHref: string };

// A press on the blank part of a grown text, below what is written: the caret goes to the end of
// the text, as a press below the last line of a page puts it there. A press in the text itself, or
// on anything of its own that takes one, is left to it.
const OWN_PRESS =
  '[contenteditable="true"], textarea, input, button, a, [role="listbox"]';

function caretToEnd(event: React.MouseEvent<HTMLElement>) {
  if ((event.target as Element).closest(OWN_PRESS)) return;
  // The editor, its source view or the plain box that stands in for it: whichever is shown.
  const field = [
    ...event.currentTarget.querySelectorAll<HTMLElement>(
      'textarea, [contenteditable="true"]',
    ),
  ].find((element) => !element.closest("[hidden]"));
  if (!field) return;
  if (field instanceof HTMLTextAreaElement) {
    field.setSelectionRange(field.value.length, field.value.length);
  } else {
    const end = document.createRange();
    end.selectNodeContents(field);
    end.collapse(false);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(end);
  }
  field.focus();
}

export function ComposerForm({
  formRef,
  onSubmit,
  frame,
  submitLabel,
  pending,
  canSubmit = true,
  top,
  placeholder,
  minHeight = 160,
  findMembers,
  onBodyChange,
  error,
  attach = true,
  attachNodeId,
  cover,
}: {
  formRef?: RefObject<HTMLFormElement | null>;
  onSubmit: React.FormEventHandler<HTMLFormElement>;
  frame: ComposerFrame;
  submitLabel: string;
  pending: boolean;
  // False until what the post needs is written; the caller says what that is.
  canSubmit?: boolean;
  // Drawn above the text, inside the scrolling part.
  top?: React.ReactNode;
  placeholder: string;
  minHeight?: number;
  findMembers?: EditorProps["findMembers"];
  // The text as it is written, for a caller that decides from it.
  onBodyChange?: (text: string) => void;
  error?: string;
  // Whether files may be added. The files already added stay in view (and can be removed) while
  // this is false: only the paperclip goes.
  attach?: boolean;
  // The forum the post is for; a message or a wall post has none.
  attachNodeId?: number;
  // Drawn instead of the composer (a choice the member makes on the way), which stays in the
  // page, text and all, until it is back.
  cover?: React.ReactNode;
}) {
  const t = useTranslations("forum.composer");
  const [uploading, setUploading] = useState(false);
  const [bar, setBar] = useState<HTMLDivElement | null>(null);
  // On a page the bar follows the keyboard up; the sheet is as tall as what is in view already.
  const { inset } = useVisualViewport(frame.kind === "page");
  const grow = frame.kind === "dialog" && frame.grow === true;
  const editor = (
    <LazyEditor
      name="body"
      placeholder={placeholder}
      minHeight={minHeight}
      toolbarContainer={bar}
      findMembers={findMembers}
      onChange={onBodyChange}
      className={cn("rounded-none border-0 bg-transparent", grow && "flex-1")}
    />
  );
  return (
    <form
      ref={formRef}
      onSubmit={onSubmit}
      className="flex min-h-0 flex-1 flex-col"
    >
      {cover}
      <div className={cn("flex min-h-0 flex-1 flex-col", cover && "hidden")}>
        <div className="flex items-center justify-between gap-2 border-b p-2">
          {frame.kind === "dialog" ? (
            <>
              <DialogClose
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={t("aria.close")}
                    className={CLOSE}
                  />
                }
              >
                <X />
              </DialogClose>
              {frame.heading && (
                <DialogTitle className="sr-only">{frame.heading}</DialogTitle>
              )}
            </>
          ) : (
            <Link
              href={frame.closeHref}
              aria-label={t("aria.close")}
              className={cn(
                buttonVariants({ variant: "ghost", size: "icon" }),
                CLOSE,
              )}
            >
              <X />
            </Link>
          )}
          <Button
            type="submit"
            disabled={pending || uploading || !canSubmit}
            className="h-10 rounded-full px-5"
          >
            {submitLabel}
          </Button>
        </div>
        <div
          className={cn(
            "min-h-0 flex-1 overflow-y-auto",
            grow && "flex flex-col",
          )}
        >
          {top}
          {grow ? (
            // biome-ignore lint/a11y/noStaticElementInteractions: only a wider way in for a pointer; keys reach the text by Tab.
            // biome-ignore lint/a11y/useKeyWithClickEvents: as above.
            <div
              data-composer-grow=""
              onClick={caretToEnd}
              className="flex flex-1 cursor-text flex-col"
            >
              {editor}
            </div>
          ) : (
            editor
          )}
          {error && <FormError className="px-3 pb-3">{error}</FormError>}
        </div>
        <div
          style={
            frame.kind === "page" && inset > 0 ? { bottom: inset } : undefined
          }
          className={cn(
            "flex flex-wrap items-center gap-x-1 gap-y-2 border-t px-1.5 pt-1",
            frame.kind === "dialog"
              ? "pb-[calc(0.25rem+env(safe-area-inset-bottom))] md:pb-1"
              : // On a page the bar stays in view: above the phone's bottom navigation, which
                // already counts the safe area, and above the keyboard when there is one.
                "sticky bottom-(--spacing-mobile-nav) z-10 bg-card pb-1 md:bottom-0",
          )}
        >
          <AttachmentField
            compact
            allowed={attach}
            nodeId={attachNodeId}
            onBusy={setUploading}
          />
          <div ref={setBar} className="min-w-0 flex-1" />
        </div>
      </div>
    </form>
  );
}
