import { getLiteState } from "@/lib/lite-mode";
import { withOwnAddresses } from "@/lib/sermo/addresses";
import { serializeJsonLd, withoutPictures } from "@/lib/sermo/seo";

// The structured data the backend gives for a page, one script each. A visitor who blocks any
// category of pictures gets none of their addresses in it.
export async function JsonLd({ items }: { items: unknown[] }) {
  if (items.length === 0) return null;
  const lite = await getLiteState();
  const strip = lite.master || lite.blocked.length > 0;
  return items.map((item, index) => (
    <script
      // biome-ignore lint/suspicious/noArrayIndexKey: the list is fixed for a render
      key={index}
      type="application/ld+json"
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
