import { defaultIconSvg } from "@/lib/default-icon";
import { liteBlocks } from "@/lib/lite-mode";
import { getSite } from "@/lib/sermo/site";

// The address browsers ask for when a page names no icon (and some do anyway). The uploaded icon
// of the site when it has one, else the default mark. LITE mode hides it, like the icon link of
// the pages: the proxy already answers a blocked picture request, this is the second gate.
export async function GET() {
  if (await liteBlocks("brand")) return new Response(null, { status: 204 });
  const { icon } = await getSite();
  if (icon) {
    return new Response(null, {
      status: 307,
      headers: { location: icon.url, "cache-control": "no-cache" },
    });
  }
  return new Response(defaultIconSvg(), {
    headers: {
      "content-type": "image/svg+xml",
      "cache-control": "public, max-age=300",
    },
  });
}
