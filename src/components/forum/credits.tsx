import { Coins } from "lucide-react";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

export function Credits({
  value,
  className,
}: {
  value: number;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 font-bold tabular-nums",
        className,
      )}
    >
      <Coins aria-hidden="true" className="size-[1em] shrink-0 text-primary" />
      {formatNumber(value)}
      <span className="sr-only"> credits</span>
    </span>
  );
}
