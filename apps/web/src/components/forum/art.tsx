import { LitePlaceholder } from "@/components/forum/lite-placeholder";
import { liteBlocks } from "@/lib/lite-mode";
import type { LiteCategory } from "@/lib/lite-preferences";
import { cn } from "@/lib/utils";

// A decorative picture drawn as a background, so it never shifts the layout:
// the caller gives the box its size (an aspect ratio or absolute insets).
export async function Art({
  src,
  category,
  className,
}: {
  src: string;
  category: LiteCategory;
  className?: string;
}) {
  if (await liteBlocks(category))
    return <LitePlaceholder className={className} />;
  return (
    <div
      aria-hidden="true"
      className={cn("pointer-events-none bg-cover bg-center", className)}
      style={{ backgroundImage: `url("${src}")` }}
    />
  );
}
