"use client";

import { type LucideIcon, X } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { type RefObject, useEffect, useState } from "react";
import { AttachmentField } from "@/components/forum/attachment-field";
import { ComposerButtons } from "@/components/forum/composer-buttons";
import { COMPOSER_PAGE_CLASS } from "@/components/forum/composer-page";
import type { EditorProps } from "@/components/forum/editor";
import type { Toolbar } from "@/components/forum/editor-toolbar";
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
// thread. It is a form with close at the top, the text with the editor's formatting bar over it,
// and XenForo's button row at the bottom: "Attach files" at the start, the labelled submit at the
// end (`ComposerButtons`). The caller puts what is its own above the text (`top`).
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
// from `md` up, over the dimmed page. The screen stays the whole screen and is opaque from its
// first frame to its last: no overlay under it and no fade or zoom, so nothing of the page shows
// while it opens or closes. From `md` its background sets off the column that what it holds
// draws. It is part of the forum's layout, so the narrower page a visitor chose narrows that
// column too (`--container-width`, globals.css).
const FILL =
  "top-0 left-0 flex h-[var(--visible-height,100dvh)] max-h-dvh max-w-none translate-x-0 sm:max-w-none translate-y-0 flex-col gap-0 rounded-none bg-background p-0";

export function sheetPopup(screen: boolean) {
  return screen
    ? {
        overlay: false,
        "data-forum-layout": "",
        className: `${FILL} ring-0 md:bg-muted data-open:animate-none! data-closed:animate-none!`,
      }
    : {
        className: `${FILL} md:top-1/2 md:left-1/2 md:h-auto md:max-h-[min(40rem,85dvh)] md:max-w-xl md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-xl`,
      };
}

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
      {...sheetPopup(screen)}
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
  // dialog is the whole screen, and the text takes all of it down to the buttons.
  | { kind: "dialog"; heading?: string; grow?: boolean }
  // On a page of its own, which has its own heading: close is a link back.
  | { kind: "page"; closeHref: string };

// A press on the blank part of a grown text, below what is written, puts the caret at the end of
// the text, as a press below the last line of a page does. Not a press in the text itself or on
// anything of its own that takes one (`target`), and not the release of a selection dragged out
// of the text into the blank part (`selection`, the document's, or `field`'s own for a plain box):
// moving the caret would undo what the member selected.
const OWN_PRESS =
  '[contenteditable="true"], textarea, input, button, a, [role="listbox"]';

export function blankPress(
  target: Pick<Element, "closest">,
  selection: Pick<Selection, "isCollapsed"> | null,
  field?: { selectionStart: number | null; selectionEnd: number | null },
) {
  if (target.closest(OWN_PRESS)) return false;
  if (selection && !selection.isCollapsed) return false;
  return !field || field.selectionStart === field.selectionEnd;
}

function caretToEnd(event: React.MouseEvent<HTMLElement>) {
  // The editor, its source view or the plain box that stands in for it: whichever is shown.
  const field = [
    ...event.currentTarget.querySelectorAll<HTMLElement>(
      'textarea, [contenteditable="true"]',
    ),
  ].find((element) => !element.closest("[hidden]"));
  if (!field) return;
  const box = field instanceof HTMLTextAreaElement ? field : null;
  if (
    !blankPress(
      event.target as Element,
      window.getSelection(),
      box && document.activeElement === box ? box : undefined,
    )
  ) {
    return;
  }
  if (box) {
    box.setSelectionRange(box.value.length, box.value.length);
  } else {
    // The end of the editor's root: the editor puts it at the end of its last block.
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
  submitIcon,
  pending,
  canSubmit = true,
  top,
  below,
  boxed = false,
  placeholder,
  minHeight = 160,
  findMembers,
  onBodyChange,
  error,
  attach = true,
  attachNodeId,
  cover,
  bar,
}: {
  formRef?: RefObject<HTMLFormElement | null>;
  onSubmit: React.FormEventHandler<HTMLFormElement>;
  frame: ComposerFrame;
  submitLabel: string;
  // The submit's icon when it is not the reply arrow (`ComposerButtons`).
  submitIcon?: LucideIcon;
  pending: boolean;
  // False until what the post needs is written; the caller says what that is.
  canSubmit?: boolean;
  // Drawn above the text, inside the scrolling part.
  top?: React.ReactNode;
  // Drawn under the text, inside the scrolling part, above the button row.
  below?: React.ReactNode;
  // The text in XenForo's editor box, inset like the fields around it, where the composer has
  // fields of its own (a new thread); otherwise it runs from edge to edge of the sheet.
  boxed?: boolean;
  placeholder: string;
  minHeight?: number;
  findMembers?: EditorProps["findMembers"];
  // The text as it is written, for a caller that decides from it.
  onBodyChange?: (text: string) => void;
  error?: string;
  // Whether files may be added. The files already added stay in view (and can be removed) while
  // this is false: only the "Attach files" button goes.
  attach?: boolean;
  // The forum the post is for; a message or a wall post has none.
  attachNodeId?: number;
  // Drawn instead of the composer (a choice the member makes on the way), which stays in the
  // page, text and all, until it is back.
  cover?: React.ReactNode;
  // The formatting bar, for a composer in view with the page (`LazyEditor`).
  bar?: typeof Toolbar;
}) {
  const t = useTranslations("forum.composer");
  const [uploading, setUploading] = useState(false);
  // On a page the buttons follow the keyboard up; the sheet is as tall as what is in view already.
  const { inset } = useVisualViewport(frame.kind === "page");
  const grow = frame.kind === "dialog" && frame.grow === true;
  const editor = (
    <LazyEditor
      name="body"
      placeholder={placeholder}
      minHeight={minHeight}
      findMembers={findMembers}
      onChange={onBodyChange}
      bar={bar}
      className={cn(
        boxed
          ? "mx-3 md:mx-4"
          : "rounded-none border-0 bg-transparent focus-within:bg-transparent",
        grow && "flex-1",
      )}
    />
  );
  return (
    <form
      ref={formRef}
      onSubmit={onSubmit}
      className="flex min-h-0 flex-1 flex-col"
    >
      {cover && grow ? (
        // On the whole screen the choice is as narrow as the Create flow's own choice of forum.
        <div className="mx-auto flex min-h-0 w-full max-w-2xl flex-1 flex-col">
          {cover}
        </div>
      ) : (
        cover
      )}
      <div className={cn("flex min-h-0 flex-1 flex-col", cover && "hidden")}>
        <div className="flex items-center gap-2 border-b p-2">
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
          {error && (
            <FormError className={cn("px-3 pb-3", boxed && "pt-3 md:px-4")}>
              {error}
            </FormError>
          )}
          {below}
        </div>
        <div
          style={
            frame.kind === "page" && inset > 0 ? { bottom: inset } : undefined
          }
          className={cn(
            "border-t px-3 pt-2",
            frame.kind === "dialog"
              ? "pb-[calc(0.5rem+env(safe-area-inset-bottom))] md:pb-2"
              : // On a page the row stays in view: above the phone's bottom navigation, which
                // already counts the safe area, and above the keyboard when there is one.
                "sticky bottom-(--spacing-mobile-nav) z-10 bg-card pb-2 md:bottom-0",
          )}
        >
          <ComposerButtons
            submitLabel={submitLabel}
            icon={submitIcon}
            order="reply"
            disabled={pending || uploading || !canSubmit}
            files={
              <AttachmentField
                compact
                allowed={attach}
                nodeId={attachNodeId}
                onBusy={setUploading}
              />
            }
          />
        </div>
      </div>
    </form>
  );
}
