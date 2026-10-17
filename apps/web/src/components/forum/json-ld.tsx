import { getLiteState } from "@/lib/lite-mode";
import { scriptNonce } from "@/lib/script-nonce";
import { withOwnAddresses } from "@/lib/sermo/addresses";
import { publicUrl } from "@/lib/sermo/config";
import {
  serializeJsonLd,
  websiteJsonLd,
  withoutPictures,
} from "@/lib/sermo/seo";
import { getSite } from "@/lib/sermo/site";

// The structured data the backend gives for a page, one script each. A visitor who blocks any
// category of pictures gets none of their addresses in it.
export async function JsonLd({ items }: { items: unknown[] }) {
  if (items.length === 0) return null;
  const [lite, nonce] = await Promise.all([getLiteState(), scriptNonce()]);
  const strip = lite.master || lite.blocked.length > 0;
  return items.map((item, index) => (
    <script
      // biome-ignore lint/suspicious/noArrayIndexKey: the list is fixed for a render
      key={index}
      type="application/ld+json"
      nonce={nonce}
      // The text is serialised with its "<" escaped.
      // biome-ignore lint/security/noDangerouslySetInnerHtml: JSON for a script element
      dangerouslySetInnerHTML={{
        __html: serializeJsonLd(
          withOwnAddresses(strip ? withoutPictures(item) : item),
        ),
      }}
    />
  ));
}

// The site itself and its search box, for the home page.
export async function WebSiteJsonLd() {
  const site = await getSite();
  const website = websiteJsonLd({ ...site, origin: publicUrl() });
  return <JsonLd items={[website]} />;
}
