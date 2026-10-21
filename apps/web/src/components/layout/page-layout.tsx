import { Container } from "@/components/layout/container";
import { cn } from "@/lib/utils";

const COLUMNS = {
  end: "lg:grid-cols-[minmax(0,1fr)_var(--aside-width)]",
  start: "lg:grid-cols-[var(--aside-width)_minmax(0,1fr)]",
};

// The page's columns: the main column and an optional aside, beside it from `lg` and below it (or
// hidden) on narrower screens. `lead` spans both columns above them; it draws nothing when empty.
export function PageLayout({
  lead,
  aside,
  asideSide = "end",
  asideOnMobile = "below",
  className,
  mainClassName,
  asideClassName,
  children,
}: {
  lead?: React.ReactNode;
  aside?: React.ReactNode;
  asideSide?: keyof typeof COLUMNS;
  asideOnMobile?: "below" | "hidden";
  className?: string;
  mainClassName?: string;
  asideClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <Container
      className={cn(
        "grid gap-(--page-gap) pt-4 pb-8 lg:items-start",
        aside && COLUMNS[asideSide],
        className,
      )}
    >
      {lead && (
        <div className="min-w-0 space-y-(--page-gap) empty:hidden lg:order-first lg:col-span-full">
          {lead}
        </div>
      )}
      <div className={cn("min-w-0", mainClassName)}>{children}</div>
      {aside && (
        <aside
          className={cn(
            "min-w-0 gap-(--page-gap)",
            asideOnMobile === "hidden" ? "hidden lg:grid" : "grid",
            asideSide === "start" && "lg:order-first",
            asideClassName,
          )}
        >
          {aside}
        </aside>
      )}
    </Container>
  );
}
