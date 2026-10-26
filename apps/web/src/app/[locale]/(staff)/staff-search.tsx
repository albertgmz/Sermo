"use client";

import { Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useSyncExternalStore } from "react";
import { isApple } from "@/components/forum/composer-submit";
import { LazyPopup } from "@/components/ui/lazy-popup";

// The search box at the top of the panel. Until it is reached for, the header holds this plain
// button; the first pointer over it, touch or focus fetches the dialog, the matching and Base UI's
// list (`staff-search-popup.tsx`), and the press opens it. Ctrl+K (⌘K on a Mac) presses it from
// anywhere in the panel, a field included; with the search open, it goes back to the search's box.
const loadPopup = () => import("./staff-search-popup");

export const TRIGGER_ID = "staff-search";
export const INPUT_ID = "staff-search-input";

// An icon on a phone, a box with its words and its keys from `sm`.
export const TRIGGER =
  "inline-flex size-10 shrink-0 items-center justify-center gap-2 rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring sm:h-9 sm:w-44 sm:justify-start sm:border sm:border-input sm:bg-card sm:px-3 sm:text-sm md:w-56 lg:w-72";

type Keys = Pick<
  KeyboardEvent,
  | "key"
  | "ctrlKey"
  | "metaKey"
  | "altKey"
  | "shiftKey"
  | "isComposing"
  | "defaultPrevented"
>;

// Ctrl+K, or ⌘K on a Mac; not with Alt or Shift, not a key that ends a word being composed, and
// not one something on the page (an editor) has already used.
export function isSearchShortcut(event: Keys, apple = isApple()) {
  const modifier = event.ctrlKey || (apple && event.metaKey);
  return (
    modifier &&
    event.key.toLowerCase() === "k" &&
    !event.altKey &&
    !event.shiftKey &&
    !event.isComposing &&
    !event.defaultPrevented
  );
}

const never = () => () => {};

// What the box shows: the same on the plain button and on the dialog's own. The server and the
// first draw name Ctrl, which a Mac then corrects.
export function TriggerFace() {
  const t = useTranslations("admin.staffSearch");
  const apple = useSyncExternalStore(never, isApple, () => false);
  return (
    <>
      <Search aria-hidden="true" className="size-5 shrink-0 sm:size-4" />
      <span className="sr-only sm:not-sr-only sm:truncate">{t("trigger")}</span>
      {/* The keys are named by the button's `aria-keyshortcuts`. */}
      <span aria-hidden="true" className="ms-auto hidden shrink-0 md:inline">
        <kbd className="rounded-sm border bg-muted px-1.5 font-sans text-xs">
          {apple ? t("shortcutApple") : t("shortcut")}
        </kbd>
      </span>
    </>
  );
}

export function StaffSearch() {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!isSearchShortcut(event)) return;
      event.preventDefault();
      const open = document.getElementById(INPUT_ID);
      if (open instanceof HTMLInputElement) {
        open.focus();
        open.select();
        return;
      }
      document.getElementById(TRIGGER_ID)?.click();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <LazyPopup
      load={loadPopup}
      popup={{}}
      trigger={(lazy) => (
        <button
          id={TRIGGER_ID}
          type="button"
          aria-haspopup="dialog"
          aria-expanded="false"
          aria-keyshortcuts="Control+K Meta+K"
          className={TRIGGER}
          {...lazy}
        >
          <TriggerFace />
        </button>
      )}
    />
  );
}
