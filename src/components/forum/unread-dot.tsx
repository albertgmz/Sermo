import { cn } from "@/lib/utils";

export function UnreadDot({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "relative size-2 shrink-0 rounded-full bg-primary",
        className,
      )}
    >
      <span className="sr-only">Unread</span>
    </span>
  );
}
