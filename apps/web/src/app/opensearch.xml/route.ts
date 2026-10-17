import { openSearchDescription } from "@/lib/opensearch";
import { publicUrl } from "@/lib/sermo/config";
import { getSite } from "@/lib/sermo/site";

// The OpenSearch description the pages link to (`rel="search"` in the root layout).
export async function GET() {
  return new Response(openSearchDescription(await getSite(), publicUrl()), {
    headers: {
      "content-type": "application/opensearchdescription+xml; charset=utf-8",
    },
  });
}
