// What the editor needs to know about BB code tags and addresses, kept equal to the backend's
// reading (packages/core/src/bbcode/scan.ts): a tag is `[NAME]`, `[NAME=option]` or the closing
// `[/NAME]`. A bare option has no bracket, quotation mark or line break; a quoted one has no
// quotation mark, bracket or line break either. Only a link's option may be longer than 200
// characters (see `optionFits`).

// Groups: 1 the slash of a closing tag, 2 the name, 3 a quoted option, 4 a bare option.
export const TAG_SOURCE = String.raw`\[(\/)?([A-Za-z]{1,10}|\*)(?:=(?:"([^"\n\]]{0,2000})"|([^\]\[\n"]{0,2000})))?\]`;

// Whether the option of a tag read with `TAG_SOURCE` is one the renderer reads: only the address
// of a link is allowed more than 200 characters.
export const optionFits = (name: string, option: string | undefined) =>
  option === undefined || option.length <= (name === "URL" ? 2000 : 200);

// One character of an address: no space, control character, bracket, angle bracket, quotation
// mark, backtick or backslash.
const ADDRESS_CHAR = String.raw`[^\s<>"\x60\\\[\]\u0000-\u001f\u007f]`;
const URL_PATTERN = new RegExp(`^https?:\\/\\/${ADDRESS_CHAR}{1,2000}$`, "i");
// A page of the site itself: a path from the root, never `//host`.
const SITE_PATH = new RegExp(`^\\/(?!\\/)${ADDRESS_CHAR}{0,2000}$`);

export const isWebAddress = (address: string) => URL_PATTERN.test(address);
export const isLinkAddress = (address: string) =>
  URL_PATTERN.test(address) || SITE_PATH.test(address);

// The address a member typed for a link, as the renderer takes it: an address with http(s) or
// a path of the site, or a bare web address (www.example.com) with https:// put before it. Null
// for anything else, which would not be a link.
export function linkAddressOf(input: string): string | null {
  const address = input.trim();
  if (isLinkAddress(address)) return address;
  const bare = /^www\.|^[\w-]+(\.[\w-]+)+(\/|$)/i.test(address)
    ? `https://${address}`
    : null;
  return bare && isWebAddress(bare) ? bare : null;
}

// A code language the renderer takes (`rich` is another kind of code block).
export const isCodeLanguage = (option: string) =>
  /^[A-Za-z0-9+#._-]{1,20}$/.test(option) && option.toLowerCase() !== "rich";

// Finds `[/NAME]` after a position. A search that found nothing is not repeated, and one that
// found a closer is reused for every opener before it, so a text full of unclosed tags is read in
// linear time. The search is on the source itself: changing its case can change its length.
export function closerFinder(source: string) {
  const known = new Map<string, number>();
  return (name: string, from: number): number => {
    const key = name.toUpperCase();
    const last = known.get(key);
    if (last === -1) return -1;
    if (last !== undefined && last >= from) return last;
    const closer = new RegExp(String.raw`\[\/${key}\]`, "gi");
    closer.lastIndex = from;
    const at = closer.exec(source)?.index ?? -1;
    known.set(key, at);
    return at;
  };
}
