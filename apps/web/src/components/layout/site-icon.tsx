import { LiteModeSync } from "@/components/layout/lite-mode-sync";
import { getLiteCookieValue, liteBlocks } from "@/lib/lite-mode";
import { liteCategoryOfPurpose } from "@/lib/lite-preferences";
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
          <link rel="icon" href={site.icon.url} type="image/png" />
        ) : (
          <link
            rel="icon"
            href="/icon.svg"
            type="image/svg+xml"
            sizes="24x24"
          />
        ))}
    </>
  );
}
