import type { GatedUrl, GatedWidth } from "@/components/forum/picture-types";
import { widthCandidates } from "@/lib/attachment-tags";
import { cn } from "@/lib/utils";

// The one place the picture viewer emits a picture (see EMISSION_GATES in
// tests/lite-static.test.ts). It draws what it is given and never decides: the address is made on
// the server by `lib/sermo/media-pictures.ts`, which leaves it out when the visitor blocks post
// pictures, so a blocked picture's address does not exist here and `blocked` says so in words.
// The box has the picture's own proportions when they are known, so nothing moves as it loads.
// With smaller copies the browser takes the one the screen needs: the viewer is the whole window
// on a phone and all of it but the details column (24rem) from `md` on.
export function PictureImage({
  url,
  width,
  height,
  widths,
  alt,
  blocked,
  className,
}: {
  url: GatedUrl | null;
  width: number | null;
  height: number | null;
  widths: readonly GatedWidth[];
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
      srcSet={widthCandidates({ url, width, widths }) ?? undefined}
      sizes="(min-width: 48rem) calc(100vw - 24rem), 100vw"
      alt={alt}
      width={width ?? undefined}
      height={height ?? undefined}
      decoding="async"
      draggable={false}
      className={cn("object-contain", className)}
    />
  );
}
