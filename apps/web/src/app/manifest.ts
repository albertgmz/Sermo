import type { MetadataRoute } from "next";
import { liteBlocks } from "@/lib/lite-mode";
import { liteCategoryOfPurpose } from "@/lib/lite-preferences";
import { manifestOf } from "@/lib/pwa";
import { getSite } from "@/lib/sermo/site";

// The web app manifest, at /manifest.webmanifest outside the language segment (the proxy lets it
// through). Next links it from every page. Its icons are brand pictures: LITE mode hides them
// like the favicon, for a browser that sends the visitor's cookies with the request.
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const site = await getSite();
  const blocked = await liteBlocks(
    site.icon ? liteCategoryOfPurpose("site_icon") : "brand",
  );
  return manifestOf(site, !blocked);
}
