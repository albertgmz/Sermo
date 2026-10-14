"use client";

import { FoldHorizontal, UnfoldHorizontal } from "lucide-react";
import { useTranslations } from "next-intl";
import { useLayoutEffect, useSyncExternalStore } from "react";
import { headerIconClass } from "@/components/layout/header-icon-class";
import {
  isNarrow,
  restoreNarrow,
  subscribeNarrow,
  toggleNarrow,
} from "@/components/layout/narrow-width";
import { cn } from "@/lib/utils";

// One label whatever the state: the pressed state says the rest. Shown only where the narrow
// width differs from the wide one (above 1100px).
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
      aria-label={t("label")}
      title={t("label")}
      onClick={onToggle}
      className={cn(
        headerIconClass,
        "hidden min-[1100px]:inline-flex",
        className,
      )}
    >
      {narrow ? <UnfoldHorizontal /> : <FoldHorizontal />}
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
