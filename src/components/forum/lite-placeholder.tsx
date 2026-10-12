import { cn } from "@/lib/utils";

export function LitePlaceholder({
  className,
  compact = false,
}: {
  className?: string;
  compact?: boolean;
}) {
  return (
    <span
      aria-label="LITE MODE"
      role="img"
      data-slot="lite-placeholder"
      className={cn(
        "pointer-events-none flex items-center justify-center overflow-hidden bg-muted text-center font-mono text-[0.625rem] leading-tight text-muted-foreground",
        className,
      )}
    >
      <span className={compact ? "sr-only" : ""}>LITE MODE</span>
    </span>
  );
}
