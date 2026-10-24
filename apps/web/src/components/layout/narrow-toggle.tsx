"use client";

import { FoldHorizontal, UnfoldHorizontal } from "lucide-react";
import { useTranslations } from "next-intl";
import { useLayoutEffect, useSyncExternalStore } from "react";
import {
  isNarrow,
  restoreNarrow,
  subscribeNarrow,
  toggleNarrow,
} from "@/components/layout/narrow-width";
import { cn } from "@/lib/utils";

// One label whatever the state: the pressed state says the rest. Drawn like the footer's theme and
// language choices, and shown only where the narrow width differs from the wide one (above
// 1100px).
export function NarrowButton({
  narrow,
  onToggle,
  className,
}: {
  narrow: boolean;
  onToggle: () => void;
  className?: string;
}) {
  const t = useTranslations("layout.narrowToggle");
  return (
    <button
      type="button"
      aria-pressed={narrow}
      onClick={onToggle}
      className={cn(
        "hidden min-h-10 cursor-pointer items-center gap-2 rounded-lg border bg-background px-2.5 py-1 text-sm font-medium text-foreground min-[1100px]:inline-flex md:min-h-8 [&_svg]:size-4 [&_svg]:text-muted-foreground aria-pressed:bg-muted",
        className,
      )}
    >
      {narrow ? (
        <UnfoldHorizontal aria-hidden="true" />
      ) : (
        <FoldHorizontal aria-hidden="true" />
      )}
      <span>{t("label")}</span>
    </button>
  );
}

export function NarrowToggle({ className }: { className?: string }) {
  const narrow = useSyncExternalStore(subscribeNarrow, isNarrow, () => false);
  useLayoutEffect(restoreNarrow, []);
  return (
    <NarrowButton
      narrow={narrow}
      onToggle={toggleNarrow}
      className={className}
    />
  );
}
