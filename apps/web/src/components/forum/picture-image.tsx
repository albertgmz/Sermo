import type { GatedUrl } from "@/components/forum/picture-types";
import { cn } from "@/lib/utils";

// The one place the picture viewer emits a picture (see EMISSION_GATES in
// tests/lite-static.test.ts). It draws what it is given and never decides: the address is made on
// the server by `lib/sermo/media-pictures.ts`, which leaves it out when the visitor blocks post
// pictures, so a blocked picture's address does not exist here and `blocked` says so in words.
// The box has the picture's own proportions when they are known, so nothing moves as it loads.
export function PictureImage({
  url,
  width,
  height,
  alt,
  blocked,
  className,
}: {
  url: GatedUrl | null;
  width: number | null;
  height: number | null;
  alt: string;
  blocked: string;
  className?: string;
}) {
  if (!url)
    return (
      <div
        role="img"
        aria-label={alt}
        className={cn(
          "flex items-center justify-center bg-muted p-4 text-center font-mono text-(length:--text-tiny) text-muted-foreground",
          className,
        )}
      >
        {blocked}
      </div>
    );
  return (
    // biome-ignore lint/performance/noImgElement: next/image optimisation is disabled
    <img
      src={url}
      alt={alt}
      width={width ?? undefined}
      height={height ?? undefined}
      decoding="async"
      draggable={false}
      className={cn("object-contain", className)}
    />
  );
}
