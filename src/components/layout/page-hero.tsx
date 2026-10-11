import { Container } from "@/components/layout/container";
import { cn } from "@/lib/utils";

export const heroTitleClass =
  "text-[clamp(2rem,1.2rem+4vw,3.75rem)] leading-[1.05] font-bold tracking-tighter";

export const heroSubtitleClass =
  "text-pretty text-[clamp(0.9375rem,0.85rem+0.4vw,1.125rem)] text-muted-foreground";

export function PageHero({
  title,
  subtitle,
  children,
  className,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <Container
      className={cn(
        "flex flex-col items-center py-12 text-center md:py-20",
        className,
      )}
    >
      <h1 className={cn("text-balance", heroTitleClass)}>{title}</h1>
      {subtitle && (
        <p className={cn("mt-3 max-w-2xl", heroSubtitleClass)}>{subtitle}</p>
      )}
      {children && (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          {children}
        </div>
      )}
    </Container>
  );
}
