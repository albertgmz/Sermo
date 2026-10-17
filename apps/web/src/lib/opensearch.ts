import { shortName } from "@/lib/pwa";

// Where a browser finds the site's search to add to its own search box (OpenSearch 1.1). Like the
// manifest it is a file of the site, not a page of a language: it sits outside that segment.
export const OPENSEARCH_URL = "/opensearch.xml";

// The spec's limit for the description; the short name (16 at most) is the home screen's one.
const DESCRIPTION_LENGTH = 1024;

const escapeXml = (text: string) =>
  text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

// The search of the results page (`/search?q=`), named as the site is.
export function openSearchDescription(
  site: { name: string; description: string },
  origin: string,
): string {
  const results = `${new URL("/search", origin).href}?q={searchTerms}`;
  const self = new URL(OPENSEARCH_URL, origin).href;
  const description = (site.description || site.name).slice(
    0,
    DESCRIPTION_LENGTH,
  );
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<OpenSearchDescription xmlns="http://a9.com/-/spec/opensearch/1.1/">',
    `<ShortName>${escapeXml(shortName(site.name))}</ShortName>`,
    `<Description>${escapeXml(description)}</Description>`,
    "<InputEncoding>UTF-8</InputEncoding>",
    `<Url type="text/html" method="get" template="${escapeXml(results)}"/>`,
    `<Url type="application/opensearchdescription+xml" rel="self" template="${escapeXml(self)}"/>`,
    "</OpenSearchDescription>",
  ].join("\n");
}
