const TAGS = [
  "B",
  "I",
  "U",
  "S",
  "COLOR",
  "FONT",
  "SIZE",
  "URL",
  "EMAIL",
  "USER",
  "IMG",
  "MEDIA",
  "ICODE",
  "PLAIN",
  "ATTACH",
  "ISPOILER",
  "LEFT",
  "CENTER",
  "RIGHT",
  "QUOTE",
  "SPOILER",
  "CODE",
  "INDENT",
  "LIST",
  "TABLE",
  "HEADING",
  "TR",
  "TH",
  "TD",
].join("|");

// A tag as the editor writes it back, with a backslash before any punctuation mark: `[\*]`,
// `[URL=https://a.com/x\_y]`, `\[B\]`. The renderer reads tags from the source as typed.
const TAG = new RegExp(
  String.raw`\\?\[(\\?/)?(${TAGS}|\\?\*)((?:=[^\]\n]*?)?)\\?\]`,
  "gi",
);
// Tags whose content is read as is (an address, an id, text): an escape there would stay in it.
const RAW =
  /\[(URL|EMAIL|USER|IMG|MEDIA|ICODE|PLAIN|ATTACH)(=[^\]\n]*)?\]([^\n]*?)\[\/\1\]/gi;
const ESCAPE = /\\([!-/:-@[-`{-~])/g;
const dropEscapes = (text: string) => text.replace(ESCAPE, "$1");

// The editor writes Markdown, which escapes "*", "_" and brackets. BB code is sent as typed, so the
// escapes inside a tag, and inside the content of the tags that take it as is, are taken out.
export function unescapeBbCode(markdown: string) {
  if (!markdown.includes("\\")) return markdown;
  return markdown
    .replace(
      TAG,
      (_, close: string | undefined, name: string, option: string) =>
        `[${close ? "/" : ""}${dropEscapes(name)}${dropEscapes(option)}]`,
    )
    .replace(
      RAW,
      (whole, name: string, option: string | undefined, text: string) =>
        // The text of [URL=...] and [ICODE=...] is formatted: its escapes mean something.
        option && /^(URL|ICODE)$/i.test(name)
          ? whole
          : whole.replace(text, () => dropEscapes(text)),
    );
}
