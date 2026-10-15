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

// A picture that is part of the content, drawn as an image the browser fetches when it comes near
// the screen (a long grid does not load every file at once). Same gate as `Art`: with the category
// blocked the placeholder takes its place and the address is never written. The caller gives the
// box its size and a name for the link or label around it.
export async function LazyArt({
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
    // biome-ignore lint/performance/noImgElement: next/image optimisation is disabled
    <img
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      className={cn("object-cover", className)}
    />
  );
}
