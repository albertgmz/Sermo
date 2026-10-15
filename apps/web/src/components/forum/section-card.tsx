import { cn } from "@/lib/utils";

// The heading line of a card of rows.
export function SectionHeader({
  title,
  description,
  action,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <header className="flex min-h-12 items-center justify-between gap-3 border-b px-4 py-2">
      <div className="min-w-0">
        <h2 className="truncate text-sm font-semibold">{title}</h2>
        {description && (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </header>
  );
}

export function SectionCard({
  title,
  description,
  action,
  children,
  className,
  contentClassName,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  return (
    <section
      className={cn("overflow-hidden rounded-lg border bg-card", className)}
    >
      <SectionHeader title={title} description={description} action={action} />
      <div className={cn("divide-y divide-border", contentClassName)}>
        {children}
      </div>
    </section>
  );
}
