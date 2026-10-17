import { LiteModeSync } from "@/components/layout/lite-mode-sync";
import { DEFAULT_ICON_URL } from "@/lib/default-icon";
import { getLiteCookieValue, liteBlocks } from "@/lib/lite-mode";
import { liteCategoryOfPurpose } from "@/lib/lite-preferences";
import { APPLE_ICON_URL } from "@/lib/pwa";
import { getSite } from "@/lib/sermo/site";

export async function SiteIcon() {
  const [cookieValue, site] = await Promise.all([
    getLiteCookieValue(),
    getSite(),
  ]);
  const blocked = await liteBlocks(
    site.icon ? liteCategoryOfPurpose("site_icon") : "brand",
  );
  return (
    <>
      <LiteModeSync cookieValue={cookieValue} />
      {!blocked &&
        (site.icon ? (
          <>
            <link rel="icon" href={site.icon.url} type="image/png" />
            <link rel="apple-touch-icon" href={site.icon.url} />
          </>
        ) : (
          <>
            <link rel="icon" href="/favicon.ico" sizes="32x32" />
            <link
              rel="icon"
              href={DEFAULT_ICON_URL}
              type="image/svg+xml"
              sizes="any"
            />
            <link
              rel="apple-touch-icon"
              href={APPLE_ICON_URL}
              sizes="180x180"
            />
          </>
        ))}
    </>
  );
}
