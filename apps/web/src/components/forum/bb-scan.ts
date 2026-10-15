// What the editor needs to know about BB code tags and addresses, kept equal to the backend's
// reading (packages/core/src/bbcode/scan.ts): a tag is `[NAME]`, `[NAME=option]` or the closing
// `[/NAME]`, with an option of at most 2,000 characters and no bracket, quotation mark or line
// break unless the whole option sits between quotation marks.

// Groups: 1 the slash of a closing tag, 2 the name, 3 a quoted option, 4 a bare option.
export const TAG_SOURCE = String.raw`\[(\/)?([A-Za-z]{1,10}|\*)(?:=(?:"([^"\n]{0,200})"|([^\]\[\n"]{0,2000})))?\]`;

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
// linear time.
export function closerFinder(source: string) {
  const lower = source.toLowerCase();
  const known = new Map<string, number>();
  return (name: string, from: number): number => {
    const closer = `[/${name.toLowerCase()}]`;
    const last = known.get(closer);
    if (last === -1) return -1;
    if (last !== undefined && last >= from) return last;
    const at = lower.indexOf(closer, from);
    known.set(closer, at);
    return at;
  };
}
