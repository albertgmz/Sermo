// What the editor needs to know about BB code tags and addresses, kept equal to the backend's
// reading (packages/core/src/bbcode/scan.ts; `bb-scan.test.ts` holds the two together): a tag is
// `[NAME]`, `[NAME=option]` or the closing `[/NAME]`. A bare option has no closing bracket,
// quotation mark or line break; a quoted one has no quotation mark, closing bracket or line
// break. Only a link's option may be longer than 200 characters, and it holds no `[`.

// Groups: 1 the slash of a closing tag, 2 the name, 3 a quoted option, 4 a bare option.
export const TAG_SOURCE = String.raw`\[(\/)?([A-Za-z]{1,10}|\*)(?:=(?:"([^"\n\]]{0,2000})"|([^\]\n"]{0,2000})))?\]`;

// The tag a match of `TAG_SOURCE` is, or null when the renderer does not read it as one (the
// caller goes on from the character after its `[`, as the renderer does).
export function tagOf(match: RegExpExecArray) {
  const name = match[2].toUpperCase();
  const option = (match[3] ?? match[4])?.trim();
  const length = option?.length ?? 0;
  if (length > (name === "URL" ? 2000 : 200)) return null;
  if (name === "URL" && option?.includes("[")) return null;
  return { closing: match[1] !== undefined, name, option };
}

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

// Whether a tag reads its content as text up to its closing tag, wherever that is found.
export function readsLiterally(name: string, option: string | undefined) {
  switch (name) {
    case "CODE":
      return option === undefined || isCodeLanguage(option);
    case "ICODE":
    case "PLAIN":
    case "IMG":
    case "URL":
    case "EMAIL":
      return option === undefined;
    case "MEDIA":
      return option !== undefined && /^[a-z]+$/i.test(option);
    case "ATTACH":
      return option === undefined || /^(?:full|thumb)$/i.test(option);
    case "USER":
      return option !== undefined && /^[1-9]\d{0,8}$/.test(option);
  }
  return false;
}

// Whether what is between a literal tag and its closing tag is something the tag takes. If it is
// not, the tag is text and what is inside is read like the rest. (The renderer also checks the
// id of a media player for its site, which the editor does not.)
export function literalContentOk(name: string, inner: string) {
  if (name === "CODE" || name === "ICODE" || name === "PLAIN") return true;
  if (inner.length > 2100) return false;
  const text = inner.trim();
  switch (name) {
    case "IMG":
      return isWebAddress(text);
    case "URL":
      return isWebAddress(/^www\./i.test(text) ? `https://${text}` : text);
    case "EMAIL":
      return EMAIL.test(text);
    case "ATTACH":
      return inner.length <= 40 && /^[1-9]\d{0,11}$/.test(text);
    case "USER":
      return text.length > 0 && text.length <= 100;
  }
  return true;
}

const COLORS = new Set(
  (
    "black silver gray grey white maroon red purple fuchsia green lime olive yellow navy blue teal " +
    "aqua orange pink brown gold cyan magenta violet indigo crimson coral salmon khaki turquoise " +
    "tan lightgray lightgrey darkgray darkgrey"
  ).split(" "),
);
const FONTS = new Set(
  "arial|book antiqua|courier new|georgia|tahoma|times new roman|trebuchet ms|verdana".split(
    "|",
  ),
);
const EMAIL = /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,200}\.[A-Za-z]{2,24}$/;

// Whether the renderer takes a tag the editor shows as text (colour, font, size, alignment,
// spoiler, table...) as a tag with this option. It does not read the others, which are text.
export function isOtherTag(name: string, option: string | undefined) {
  const lower = option?.toLowerCase();
  switch (name) {
    case "COLOR":
      return (
        lower !== undefined &&
        (/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/.test(lower) || COLORS.has(lower))
      );
    case "FONT":
      return lower !== undefined && FONTS.has(lower);
    case "SIZE":
      return option !== undefined && /^[1-7]$/.test(option);
    case "EMAIL":
      return option !== undefined && EMAIL.test(option);
    case "SPOILER":
    case "QUOTE":
      return true;
    case "INDENT":
      return option === undefined || /^[1-5]$/.test(option);
    case "ISPOILER":
    case "LEFT":
    case "CENTER":
    case "RIGHT":
    case "TABLE":
    case "TR":
    case "TH":
    case "TD":
      return option === undefined;
  }
  return false;
}

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
