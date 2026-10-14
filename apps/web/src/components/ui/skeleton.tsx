import { cn } from "cn";

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden="true"
      className={cn(
        "motion-safe:animate-pulse rounded-md bg-skeleton",
        className,
      )}
      {...props}
    />
  );
}

export { Skeleton };
