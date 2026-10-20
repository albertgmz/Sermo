import { liteBlocks } from "@/lib/lite-mode";
import { liteCategoryOfPurpose } from "@/lib/lite-preferences";
import { DEFAULT_BADGE_PNG, DEFAULT_ICON_PNG } from "@/lib/pwa-icon-data";
import { getSite } from "@/lib/sermo/site";

// The default mark of the manifest and of the iOS home screen, for a site that has not uploaded an
// icon, and the pictures of a push notification (`lib/push-worker.ts`): the app's icon at 192 and
// the badge. The service worker does not know the site, so a site with an uploaded icon is sent
// there (the manifest and the pages name it directly), and its notifications take the browser's own
// badge rather than the default mark. LITE mode hides these like the favicon: the proxy does not
// reach this address, so this is the only gate.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ size: string }> },
) {
  const { size } = await params;
  if (size !== "180" && size !== "192" && size !== "512" && size !== "badge")
    return new Response(null, { status: 404 });
  // The answer depends on the visitor's LITE cookie.
  const vary = { vary: "cookie" };
  const { icon } = await getSite();
  if (icon) {
    if (size === "badge")
      return new Response(null, { status: 404, headers: vary });
    if (await liteBlocks(liteCategoryOfPurpose("site_icon")))
      return new Response(null, { status: 204, headers: vary });
    return new Response(null, {
      status: 307,
      headers: { ...vary, location: icon.url, "cache-control": "no-cache" },
    });
  }
  if (await liteBlocks("brand"))
    return new Response(null, { status: 204, headers: vary });
  const png = size === "badge" ? DEFAULT_BADGE_PNG : DEFAULT_ICON_PNG[size];
  return new Response(Buffer.from(png, "base64"), {
    headers: {
      ...vary,
      "content-type": "image/png",
      "cache-control": "public, max-age=86400",
    },
  });
}
