"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";

// The list of who reacted, asked for when the popover opens (it mounts only then).
export function ReactionUsers({
  load,
}: {
  load: () => Promise<React.ReactNode>;
}) {
  const t = useTranslations("forum.reactionSummary");
  const [list, setList] = useState<React.ReactNode>();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    load().then(setList, () => setFailed(true));
  }, [load]);

  if (failed) {
    return (
      <p className="px-3 py-2 text-sm text-muted-foreground">{t("failed")}</p>
    );
  }
  return (
    list ?? (
      <div aria-hidden="true" className="space-y-2 px-3 py-2">
        <Skeleton className="h-6 w-full" />
        <Skeleton className="h-6 w-2/3" />
      </div>
    )
  );
}
