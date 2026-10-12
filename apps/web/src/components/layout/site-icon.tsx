import { LiteModeSync } from "@/components/layout/lite-mode-sync";
import { getLiteCookieValue, liteBlocks } from "@/lib/lite-mode";
import { liteCategoryOfPurpose } from "@/lib/lite-preferences";
import { getSite } from "@/lib/sermo/site";

// The icon of a site that has not uploaded one: the drawn mark of `Logo`, as data so that no file
// is served for it. It is percent-encoded here because this file only hands it to the browser.
const DEFAULT_ICON =
  "data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2024%2024%22%20width%3D%2224%22%20height%3D%2224%22%20fill%3D%22none%22%20stroke%3D%22%23dc2626%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%3E%3Cpath%20d%3D%22M5%2019%2015%205%22%2F%3E%3Cpath%20d%3D%22M13%2019l6-8%22%2F%3E%3C%2Fsvg%3E";

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
            href={DEFAULT_ICON}
            type="image/svg+xml"
            sizes="24x24"
          />
        ))}
    </>
  );
}
