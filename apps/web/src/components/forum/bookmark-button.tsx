"use client";

import { Bookmark, BookmarkCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { setBookmark } from "@/app/[locale]/(main)/actions";
import { FormError } from "@/components/forum/form-error";
import { Button } from "@/components/ui/button";
import { changeItem, useItemState } from "@/lib/item-state";
import { cn } from "@/lib/utils";

// Why the backend refused the change, under the button: on its own line, or floating over what
// follows (`floating`, as wide as the words need up to 16rem) where the button sits in a row.
export function BookmarkRefusal({
  floating,
  children,
}: {
  floating: boolean;
  children: string;
}) {
  return (
    <FormError
      className={cn(
        "text-xs",
        floating &&
          "absolute top-full right-0 z-10 w-max max-w-64 rounded-md border bg-popover px-2 py-1 shadow-md",
      )}
    >
      {children}
    </FormError>
  );
}

// Bookmarks or un-bookmarks an item from where it is drawn and stays on the page: the action asks
// for the opposite of what is shown, which shows at once and is put back when the backend refuses
// (the refusal is shown under the button). The label carries the state (no `aria-pressed`: a
// reader would say "Remove bookmark, pressed").
export function BookmarkButton(props: {
  contentType: "thread" | "post" | "conversation";
  contentId: number;
  bookmarked: boolean;
  className?: string;
  // How the visible text is hidden where only the icon fits; `className` then gives the button the
  // width of a touch target.
  labelClassName?: string;
  // In a row of small controls (a post's header row) the refusal floats under the button, over
  // what follows, instead of widening the row; elsewhere it takes its own line under it.
  floatingError?: boolean;
}) {
  const {
    contentType,
    contentId,
    bookmarked,
    className,
    labelClassName,
    floatingError = false,
  } = props;
  const t = useTranslations("ui.bookmark");
  const tFailed = useTranslations("lib.errors");
  const router = useRouter();
  const [pending, start] = useTransition();
  const stateKey = `bookmark:${contentType}:${contentId}`;
  const shown = useItemState(stateKey, bookmarked, props);
  const [error, setError] = useState<string | undefined>();
  const label = t(shown ? "remove" : "add");
  return (
    <div
      className={cn(
        "flex min-w-0 max-w-full flex-col",
        floatingError && "relative shrink-0",
      )}
    >
      <Button
        type="button"
        variant="ghost"
        // Kept focusable while the write runs: a disabled button hands its focus to the page.
        disabled={pending}
        focusableWhenDisabled
        aria-label={label}
        className={cn(
          "h-10 px-2 text-xs text-muted-foreground aria-disabled:opacity-50",
          className,
        )}
        onClick={() =>
          start(async () => {
            const { error: refused, signIn } = await changeItem(
              stateKey,
              bookmarked,
              !shown,
              () => setBookmark(contentType, contentId, !shown),
              tFailed("generic"),
            );
            if (signIn) router.push(signIn);
            else setError(refused);
          })
        }
      >
        {shown ? <BookmarkCheck /> : <Bookmark />}
        <span className={cn(labelClassName)}>{label}</span>
      </Button>
      {error && (
        <BookmarkRefusal floating={floatingError}>{error}</BookmarkRefusal>
      )}
    </div>
  );
}
