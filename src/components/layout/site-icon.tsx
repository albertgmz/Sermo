import { LiteModeSync } from "@/components/layout/lite-mode-sync";
import { getLiteCookieValue, liteBlocks } from "@/lib/lite-mode";

export async function SiteIcon() {
  const [cookieValue, blocked] = await Promise.all([
    getLiteCookieValue(),
    liteBlocks("brand"),
  ]);
  return (
    <>
      <LiteModeSync cookieValue={cookieValue === "1" ? "all" : cookieValue} />
      {!blocked && (
        <link rel="icon" href="/icon.svg" type="image/svg+xml" sizes="24x24" />
      )}
    </>
  );
}
