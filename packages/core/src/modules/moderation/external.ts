/**
 * What a rendered text sends a reader to another site for. The renderer's output is sanitized
 * and regular (double-quoted attributes, `>` and `"` escaped inside values), so the three
 * elements that do it are found by pattern: links, pictures and embedded players.
 */
const ANCHOR = /<a\b[^>]*?\shref="(https?:\/\/[^"]*)"[^>]*>/gi;
const PICTURE = /<img\b[^>]*>/gi;
const PLAYER = /<iframe\b[^>]*><\/iframe>/gi;

function attribute(tag: string, name: string): string | undefined {
  return new RegExp(`\\s${name}="([^"]*)"`, "i").exec(tag)?.[1];
}

function hostOf(address: string): string | null {
  try {
    return new URL(address.replace(/&amp;/g, "&")).host.toLowerCase();
  } catch {
    return null;
  }
}

/** The hosts of the site itself: what points there is not "another site". */
export function ownHosts(origins: readonly (string | undefined)[]): Set<string> {
  return new Set(
    origins.flatMap((origin) => {
      const host = origin ? hostOf(origin) : null;
      return host ? [host] : [];
    }),
  );
}

const elsewhere = (address: string | undefined, own: ReadonlySet<string>): address is string =>
  address !== undefined && /^https?:\/\//i.test(address) && !own.has(hostOf(address) ?? "");

/** Whether any of the texts holds a link, picture or player that leads to another site. */
export function hasExternalLinks(htmls: readonly string[], own: ReadonlySet<string>): boolean {
  return htmls.some((html) => {
    for (const anchor of html.matchAll(ANCHOR)) if (elsewhere(anchor[1], own)) return true;
    for (const [tag] of html.matchAll(PICTURE))
      if (elsewhere(attribute(tag, "src"), own)) return true;
    return /<iframe\b/i.test(html);
  });
}

/** The same text with pictures and players from other sites shown as links to them. */
export function externalMediaAsLinks(html: string, own: ReadonlySet<string>): string {
  const link = (address: string, text: string, className = "") =>
    `<a${className} href="${address}" rel="nofollow ugc noopener">${text}</a>`;
  return html
    .replace(PICTURE, (tag) => {
      const source = attribute(tag, "src");
      if (!elsewhere(source, own)) return tag;
      return link(source, attribute(tag, "alt") || source);
    })
    .replace(PLAYER, (tag) => {
      const address = attribute(tag, "data-media-url") ?? attribute(tag, "src");
      return address ? link(address, address, ' class="bb-media-link"') : tag;
    });
}
