// The site's files for crawlers and agents, named in a `Link` header (RFC 8288) on every answer
// of the proxy, so a client that reads no HTML still finds them: the sitemap, the guide for
// language models, the API catalog (RFC 9727) and the site's feed. Root-relative, so they name
// whatever address the site was reached at. Only site-wide files: a page's own alternates (a
// thread's Markdown copy, a forum's feed) are `<link>` elements in its head.
export const DISCOVERY_LINKS = [
  '</sitemap.xml>; rel="sitemap"; type="application/xml"',
  '</llms.txt>; rel="describedby"; type="text/plain"',
  '</.well-known/api-catalog>; rel="api-catalog"; type="application/linkset+json"',
  '</feed.atom>; rel="alternate"; type="application/atom+xml"',
].join(", ");
