"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, useTransition } from "react";
import { LoadingRegion } from "@/components/forum/skeletons";
import { HeaderPanel } from "@/components/layout/header-panel";
import { Skeleton } from "@/components/ui/skeleton";
import { type CounterKind, useCounter } from "@/lib/counters";

const emptyClass = "px-4 py-8 text-center text-sm text-muted-foreground";

// The rows of a panel while they are being asked for.
function PanelSkeleton({ label }: { label: string }) {
  return (
    <LoadingRegion label={label}>
      <ul aria-hidden="true" className="divide-y divide-border">
        {[1, 2, 3].map((row) => (
          <li key={row} className="flex items-center gap-3 px-4 py-3">
            <Skeleton className="size-10 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          </li>
        ))}
      </ul>
    </LoadingRegion>
  );
}

// A header panel whose list is asked for when the visitor opens it, never with the page. `load`
// is a server action that returns the rendered rows. The rows of the last opening stay up while
// a new one is fetched, and when the unread count changes under an open panel they are fetched
// again.
export function LoadedPanel({
  label,
  title,
  unread: drawn,
  counter,
  icon,
  className,
  loadingLabel,
  load,
  footer,
}: {
  label: string;
  title: string;
  // The count the page drew, and which count it is: a poll finds newer ones.
  unread: number;
  counter: CounterKind;
  icon: React.ReactNode;
  className?: string;
  loadingLabel: string;
  load: () => Promise<React.ReactNode>;
  footer: React.ReactNode;
}) {
  const t = useTranslations("layout.headerPanels");
  const unread = useCounter(counter, drawn);
  const [rows, setRows] = useState<React.ReactNode>();
  const [failed, setFailed] = useState(false);
  const [, startTransition] = useTransition();
  const opened = useRef(false);

  function refresh() {
    startTransition(async () => {
      try {
        setRows(await load());
        setFailed(false);
      } catch {
        setFailed(true);
      }
    });
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: the count is the trigger, not an input
  useEffect(() => {
    if (opened.current) refresh();
  }, [unread]);

  return (
    <HeaderPanel
      label={label}
      title={title}
      unread={unread}
      icon={icon}
      className={className}
      onOpenChange={(open) => {
        opened.current = open;
        if (open) refresh();
      }}
    >
      {failed && rows === undefined ? (
        <p className={emptyClass}>{t("failed")}</p>
      ) : rows === undefined ? (
        <PanelSkeleton label={loadingLabel} />
      ) : (
        rows
      )}
      {footer}
    </HeaderPanel>
  );
}
