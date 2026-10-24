import { cn } from "@/lib/utils";

declare const gated: unique symbol;
// The address of a forum's picture that LITE let through. Only `lib/sermo/forum-choices.ts` makes
// one, on the server, and it is null when the visitor blocks forum art: the chooser draws what it
// is given and never decides, so the address of a blocked picture does not exist in the browser.
export type ForumArtUrl = string & { readonly [gated]: true };
// A forum's picture: a cover is drawn behind the title, an icon (square, small) beside it.
export type ForumArt = { url: ForumArtUrl; kind: "cover" | "icon" };

// The one place the forum chooser emits a forum's picture (see EMISSION_GATES in
// tests/lite-static.test.ts): fetched when it comes near the screen, so a long list does not load
// every file at once. Decoration next to the forum's title: the caller gives the box its size.
export function ForumChoiceArt({
  url,
  className,
}: {
  url: ForumArtUrl;
  className?: string;
}) {
  return (
    // biome-ignore lint/performance/noImgElement: next/image optimisation is disabled
    <img
      src={url}
      alt=""
      loading="lazy"
      decoding="async"
      draggable={false}
      className={cn("pointer-events-none object-cover", className)}
    />
  );
}
