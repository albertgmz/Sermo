import { cn } from "@/lib/utils";

// The count drawn on a badge: short for a large number.
export function badgeText(count: number): string {
  return count > 99 ? "99+" : String(count);
}

// The number over an icon (unread alerts, unread conversations): 1 to 99, then "99+", and nothing
// at 0. It is drawn for the eye only: the control it sits on carries "N unread" in its name, so a
// screen reader hears the count once. The caller places it (`className`) against the icon.
export function CountBadge({
  count,
  className,
}: {
  count: number;
  className?: string;
}) {
  if (count <= 0) return null;
  return (
    <span
      aria-hidden="true"
      data-slot="count-badge"
      className={cn(
        "pointer-events-none absolute inline-flex h-4 min-w-4 items-center justify-center rounded-sm bg-primary px-1 text-(length:--text-caption) leading-none font-bold text-primary-foreground tabular-nums ring-2 ring-background",
        className,
      )}
    >
      {badgeText(count)}
    </span>
  );
}
