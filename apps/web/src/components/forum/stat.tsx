import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

// A count in a card. With `href` the whole card is the link, and `action` says what it opens (shown
// at its foot), so the words are never left floating under the card they belong to.
export function StatTile({
  label,
  value,
  icon: Icon,
  href,
  action,
  className,
}: {
  label: string;
  value: React.ReactNode;
  icon?: LucideIcon;
  href?: string;
  action?: string;
  className?: string;
}) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-xs font-semibold">{label}</span>
        {Icon && <Icon className="size-4 shrink-0 text-muted-foreground" />}
      </div>
      <div className="mt-3 text-xl font-bold tabular-nums tracking-tight">
        {value}
      </div>
      {href && action && (
        <span className="mt-3 block text-xs text-primary-ink underline-offset-4 group-hover:underline">
          {action}
        </span>
      )}
    </>
  );
  const card = "rounded-lg border bg-card p-4";
  if (!href) return <div className={cn(card, className)}>{body}</div>;
  return (
    <Link
      href={href}
      className={cn(
        card,
        "group block outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      {body}
    </Link>
  );
}

export function StatInline({
  label,
  value,
  className,
}: {
  label: string;
  value: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col", className)}>
      <span className="text-base leading-tight font-bold tabular-nums">
        {value}
      </span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}
