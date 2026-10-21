import { Art, LazyArt } from "@/components/forum/art";

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
        className="absolute inset-0 -z-10 bg-linear-to-r from-background/95 from-25% via-background/75 via-60% to-background/40"
      />
    </>
  );
}
