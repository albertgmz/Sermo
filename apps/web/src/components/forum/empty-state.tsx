import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function EmptyState({
  icon: Icon,
  title,
  description,
  children,
  className,
}: {
  icon?: LucideIcon;
  title: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center px-4 py-10 text-center",
        className,
      )}
    >
      {Icon && (
        <div className="mb-3 flex size-10 items-center justify-center rounded-full border bg-muted text-muted-foreground">
          <Icon className="size-5" />
        </div>
      )}
      <p className="max-w-full text-sm font-semibold [overflow-wrap:anywhere]">
        {title}
      </p>
      {description && (
        <p className="mt-1 max-w-sm text-sm text-pretty text-muted-foreground">
          {description}
        </p>
      )}
      {children && (
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          {children}
        </div>
      )}
    </div>
  );
}
