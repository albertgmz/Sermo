import { Art } from "@/components/forum/art";
import type { PictureView } from "@/lib/sermo/views";
import { cn } from "@/lib/utils";

const VARIANTS = {
  header:
    "inset-x-0 top-0 h-28 rounded-t-[inherit] opacity-15 [mask-composite:intersect] [mask-image:linear-gradient(to_bottom,black,transparent),linear-gradient(to_left,black_25%,transparent)]",
  full: "inset-0 rounded-[inherit] opacity-10 [mask-image:linear-gradient(to_left,black,transparent_90%)]",
  strip:
    "inset-x-0 top-0 h-16 rounded-t-[inherit] opacity-45 [mask-image:linear-gradient(to_bottom,black_35%,transparent)]",
};

// Sits behind the content of a `relative isolate` parent. Members without a
// profile cover get nothing.
export function CoverBackdrop({
  cover,
  variant = "header",
  className,
}: {
  cover: PictureView | null;
  variant?: keyof typeof VARIANTS;
  className?: string;
}) {
  if (!cover) return null;
  return (
    <Art
      category="profileCovers"
      className={cn(
        "pointer-events-none absolute -z-10 bg-cover bg-[position:75%_30%]",
        VARIANTS[variant],
        className,
      )}
      src={cover.url}
    />
  );
}
