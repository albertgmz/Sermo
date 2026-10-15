"use client";

import { Bookmark, BookmarkCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { setBookmark } from "@/app/[locale]/(main)/actions";
import { FormError } from "@/components/forum/form-error";
import { Button } from "@/components/ui/button";
import { changeItem, useItemState } from "@/lib/item-state";
import { cn } from "@/lib/utils";

// Bookmarks or un-bookmarks an item from where it is drawn and stays on the page: the action asks
// for the opposite of what is shown, which shows at once and is put back when the backend refuses
// (the refusal is shown under the button). The label carries the state (no `aria-pressed`: a
// reader would say "Remove bookmark, pressed").
export function BookmarkButton({
  contentType,
  contentId,
  bookmarked,
  className,
  labelClassName,
}: {
  contentType: "thread" | "post" | "conversation";
  contentId: number;
  bookmarked: boolean;
  className?: string;
  // How the visible text is hidden where only the icon fits; `className` then gives the button the
  // width of a touch target.
  labelClassName?: string;
}) {
  const t = useTranslations("ui.bookmark");
  const [pending, start] = useTransition();
  const stateKey = `bookmark:${contentType}:${contentId}`;
  const shown = useItemState(stateKey, bookmarked);
  const [error, setError] = useState<string | undefined>();
  const label = t(shown ? "remove" : "add");
  return (
    <div className="flex min-w-0 max-w-full flex-col">
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
            setError(
              await changeItem(stateKey, bookmarked, !shown, () =>
                setBookmark(contentType, contentId, !shown),
              ),
            );
          })
        }
      >
        {shown ? <BookmarkCheck /> : <Bookmark />}
        <span className={cn(labelClassName)}>{label}</span>
      </Button>
      {error && <FormError className="text-xs">{error}</FormError>}
    </div>
  );
}
