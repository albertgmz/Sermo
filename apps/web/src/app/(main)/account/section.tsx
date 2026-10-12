import { cn } from "@/lib/utils";

// The label / control / help row of the account forms.
export const rowClass =
  "grid gap-3 p-4 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-6";

export const linkClass =
  "inline-flex min-h-10 items-center text-primary underline-offset-4 hover:underline";

export const selectClass =
  "h-10 w-full min-w-0 rounded-lg border border-input bg-card px-2.5 text-base outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:h-8 md:text-sm";

export function Section({
  id,
  heading,
  description,
  children,
  className,
}: {
  id?: string;
  heading: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      id={id}
      className={cn("min-w-0 scroll-mt-4 rounded-lg border bg-card", className)}
    >
      <div className="border-b p-4">
        <h2 className="text-sm font-semibold">{heading}</h2>
        {description && (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
      </div>
      {children}
    </section>
  );
}

export function Row({
  id,
  label,
  htmlFor,
  children,
}: {
  id?: string;
  label: React.ReactNode;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div id={id} className={cn(rowClass, "scroll-mt-4")}>
      {htmlFor ? (
        <label
          htmlFor={htmlFor}
          className="self-start text-sm font-medium sm:pt-3"
        >
          {label}
        </label>
      ) : (
        <p className="self-start text-sm font-medium sm:pt-1">{label}</p>
      )}
      <div className="min-w-0 space-y-2">{children}</div>
    </div>
  );
}

export function Help({
  id,
  children,
}: {
  id?: string;
  children: React.ReactNode;
}) {
  return (
    <p id={id} className="text-xs text-pretty text-muted-foreground">
      {children}
    </p>
  );
}
