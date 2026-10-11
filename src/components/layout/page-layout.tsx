import { Container } from "@/components/layout/container";
import { cn } from "@/lib/utils";

const COLUMNS = {
  end: "lg:grid-cols-[minmax(0,1fr)_var(--aside-width)]",
  start: "lg:grid-cols-[var(--aside-width)_minmax(0,1fr)]",
};

export function PageLayout({
  aside,
  asideSide = "end",
  asideOnMobile = "below",
  className,
  mainClassName,
  children,
}: {
  aside?: React.ReactNode;
  asideSide?: keyof typeof COLUMNS;
  asideOnMobile?: "below" | "hidden";
  className?: string;
  mainClassName?: string;
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
      <div className={cn("min-w-0", mainClassName)}>{children}</div>
      {aside && (
        <aside
          className={cn(
            "min-w-0 gap-(--page-gap)",
            asideOnMobile === "hidden" ? "hidden lg:grid" : "grid",
            asideSide === "start" && "lg:order-first",
          )}
        >
          {aside}
        </aside>
      )}
    </Container>
  );
}
