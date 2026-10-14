"use client";

import { FoldHorizontal, UnfoldHorizontal } from "lucide-react";
import { useTranslations } from "next-intl";
import { useLayoutEffect, useSyncExternalStore } from "react";
import { headerIconClass } from "@/components/layout/header-panels";
import {
  applyNarrow,
  readNarrow,
  subscribeNarrow,
  writeNarrow,
} from "@/components/layout/narrow-width";
import { cn } from "@/lib/utils";

// Shown only where the narrow width differs from the wide one (above 1100px).
export function NarrowToggle({ className }: { className?: string }) {
  const t = useTranslations("layout.narrowToggle");
  const narrow = useSyncExternalStore(subscribeNarrow, readNarrow, () => false);
  // React resets attributes it does not manage when development remounts the root.
  useLayoutEffect(() => {
    if (narrow) applyNarrow(true);
  }, [narrow]);
  return (
    <button
      type="button"
      aria-pressed={narrow}
      aria-label={t(narrow ? "wide" : "narrow")}
      title={t(narrow ? "wide" : "narrow")}
      onClick={() => writeNarrow(!narrow)}
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
