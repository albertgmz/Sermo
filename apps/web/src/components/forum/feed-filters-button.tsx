"use client";

import { SlidersHorizontal } from "lucide-react";
import { useTranslations } from "next-intl";
import type { FeedFiltersPopupProps } from "@/components/forum/feed-filters-popup";
import { buttonVariants } from "@/components/ui/button";
import { LazyPopup } from "@/components/ui/lazy-popup";
import type { FeedFilterValue } from "@/lib/feed-filters";
import type { HomeTab } from "@/lib/home-tabs";
import { cn } from "@/lib/utils";

// The sheet's code (Base UI, the form) is fetched when the button is first reached for; until then
// the button is a plain one, so the feed's first load does not carry the filters.
const loadPopup = () => import("@/components/forum/feed-filters-popup");

export const FILTERS_BUTTON = cn(
  buttonVariants({ variant: "outline" }),
  "h-10 gap-2 px-3 md:h-8",
);

// The button that opens the filters of the home feed: `count` is how many fields are on now.
export function FeedFiltersButton({
  tab,
  filter,
  count,
}: {
  tab: HomeTab;
  filter: FeedFilterValue;
  count: number;
}) {
  const t = useTranslations("forum.feedFilters");
  const label = count > 0 ? t("buttonCount", { count }) : t("button");
  const popup: FeedFiltersPopupProps = { tab, filter, label };
  return (
    <LazyPopup
      load={loadPopup}
      popup={popup}
      trigger={(lazy) => (
        <button
          type="button"
          data-slot="sheet-trigger"
          aria-haspopup="dialog"
          aria-expanded="false"
          className={FILTERS_BUTTON}
          {...lazy}
        >
          <SlidersHorizontal aria-hidden="true" />
          {label}
        </button>
      )}
    />
  );
}
