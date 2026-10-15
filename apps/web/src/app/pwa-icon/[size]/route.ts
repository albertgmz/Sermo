import { liteBlocks } from "@/lib/lite-mode";
import { DEFAULT_ICON_PNG } from "@/lib/pwa-icon-data";

// The default mark of the manifest, for a site that has not uploaded an icon. LITE mode hides it
// like the favicon: the proxy does not reach this address, so this is the only gate.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ size: string }> },
) {
  const { size } = await params;
  if (size !== "192" && size !== "512")
    return new Response(null, { status: 404 });
  // The answer depends on the visitor's LITE cookie.
  const vary = { vary: "cookie" };
  if (await liteBlocks("brand"))
    return new Response(null, { status: 204, headers: vary });
  return new Response(Buffer.from(DEFAULT_ICON_PNG[size], "base64"), {
    headers: {
      ...vary,
      "content-type": "image/png",
      "cache-control": "public, max-age=86400",
    },
  });
}
