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

// Fenced code blocks and inline code spans, which the editor writes as the text is and which read
// back as it is: a backslash in them is part of the code.
const CODE =
  /^(\x60{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^\1[ \t]*$|(?![\s\S]))|(\x60+)(?!\x60)[^\n]*?[^\x60\n]\2(?!\x60)/gm;

function restore(text: string) {
  return text
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

// The editor writes Markdown, which escapes "*", "_" and brackets. BB code is sent as typed, so the
// escapes inside a tag, and inside the content of the tags that take it as is, are taken out. Code
// is left as the editor wrote it.
export function unescapeBbCode(markdown: string) {
  if (!markdown.includes("\\")) return markdown;
  let out = "";
  let from = 0;
  for (const code of markdown.matchAll(CODE)) {
    out += restore(markdown.slice(from, code.index)) + code[0];
    from = code.index + code[0].length;
  }
  return out + restore(markdown.slice(from));
}
