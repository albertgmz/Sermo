import { Art, LazyArt } from "@/components/forum/art";
import { liteBlocks } from "@/lib/lite-mode";

// The scrim over the picture: the page background at no less than 75% anywhere, so text and
// controls over any part of any picture keep their contrast (tests/theme-contrast.test.ts blends
// it over the worst picture for each theme). A header over a cover draws its text and controls
// in the foreground colour, never the muted one.
export const BANNER_SCRIM =
  "bg-linear-to-r from-background/95 from-25% to-background/75";

// The forum's cover behind a header, as XenForo draws it. Sits in a `relative isolate
// overflow-hidden` parent that sets its own height, so the picture never changes the layout. The
// scrim is the page background with the opacity of the tokens, so the title stays readable on the
// brightest picture in both themes.
//
// Props
//   cover  The node's cover.
//   lazy   A header that may be below the fold: the browser fetches the picture when it comes
//          near the screen. The page's own header is drawn at once.
export function ForumBanner({
  cover,
  lazy = false,
}: {
  cover: { url: string };
  lazy?: boolean;
}) {
  const className = "absolute inset-0 -z-20 size-full";
  return (
    <>
      {lazy ? (
        <LazyArt src={cover.url} category="forumArt" className={className} />
      ) : (
        <Art src={cover.url} category="forumArt" className={className} />
      )}
      <div
        aria-hidden="true"
        className={`absolute inset-0 -z-10 ${BANNER_SCRIM}`}
      />
    </>
  );
}

// The banner of a header, or null for a node with no cover and when LITE mode blocks forum
// pictures: the header then stays plain, with no grey box behind the title and no placeholder
// announced to screen readers, since the picture is decoration.
export async function bannerOf(cover: { url: string } | null, lazy = false) {
  if (!cover || (await liteBlocks("forumArt"))) return null;
  return <ForumBanner cover={cover} lazy={lazy} />;
}
