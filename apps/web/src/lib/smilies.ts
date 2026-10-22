// The site's smilies (`smilies.list`): codes such as `:LOL:` or `(y)` that a text shows as their
// emoji. Bodies keep the codes as they were typed; they are replaced here, where the stored HTML is
// shown, so old posts show them too and a change to the smilies needs no re-render.
export type Smilie = {
  id: number;
  title: string;
  codes: string[];
  emoji: string;
};

// As the backend escapes text (packages/core/src/bbcode/escape.ts).
export function escapeText(value: string) {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character] as string,
  );
}

type Matcher = { pattern: RegExp; html: Map<string, string> };

// Built once per list: the escaped form of every code (the stored HTML holds `&gt;:(`) and what
// it becomes. The longest code is tried first, as XenForo's `strtr` does.
const matchers = new WeakMap<Smilie[], Matcher | null>();

function matcherOf(smilies: Smilie[]): Matcher | null {
  let matcher = matchers.get(smilies);
  if (matcher !== undefined) return matcher;
  const html = new Map<string, string>();
  for (const smilie of smilies) {
    const title = escapeText(smilie.title);
    for (const code of smilie.codes) {
      const escaped = escapeText(code);
      if (escaped && !html.has(escaped))
        html.set(
          escaped,
          `<span class="smilie" role="img" aria-label="${title}" title="${title} ${escaped}">${escapeText(smilie.emoji)}</span>`,
        );
    }
  }
  const codes = [...html.keys()].sort((a, b) => b.length - a.length);
  const literal = (code: string) => code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // An entity of the text is matched whole and given back as it is, so a code that starts with its
  // last character (";)" in "&#39;)") is not found inside it; a code that starts with an entity
  // ("&gt;:(") is tried before it.
  const leading = codes.filter((code) => code.startsWith("&"));
  const rest = codes.filter((code) => !code.startsWith("&"));
  matcher =
    codes.length === 0
      ? null
      : {
          pattern: new RegExp(
            [...leading.map(literal), "&#?\\w+;", ...rest.map(literal)].join(
              "|",
            ),
            "g",
          ),
          html,
        };
  matchers.set(smilies, matcher);
  return matcher;
}

const TAG = /<(\/?)([a-zA-Z][\w-]*)([^>]*)>/g;
const VOID = new Set([
  "area",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "source",
  "track",
  "wbr",
]);
// Where XenForo stops smilies: code, plain text, links (a mention is one), and the names and
// labels BB code draws around a text (a quote's author, a spoiler's title, a code block's header).
const KEEP = new Set(["a", "code", "pre", "cite", "summary", "button"]);
const KEEP_CLASS =
  /\bclass="[^"]*\b(?:bb-plain|bb-attach|bb-code-header|smilie)\b/;

// The HTML with every smilie code in its text replaced by the smilie, outside the elements above.
// The HTML is the backend's sanitised output: well formed, with every `>` in text escaped.
export function withSmilies(html: string, smilies: Smilie[]): string {
  const matcher = matcherOf(smilies);
  if (!matcher) return html;
  // The open elements, each with whether smilies stop inside it.
  const open: boolean[] = [];
  let kept = 0;
  let out = "";
  let last = 0;
  const text = (end: number) => {
    const part = html.slice(last, end);
    out +=
      kept > 0
        ? part
        : part.replace(
            matcher.pattern,
            (code) => matcher.html.get(code) ?? code,
          );
  };
  for (const tag of html.matchAll(TAG)) {
    text(tag.index);
    out += tag[0];
    last = tag.index + tag[0].length;
    const [, closing, rawName, attributes] = tag;
    const name = rawName.toLowerCase();
    if (closing) {
      if (open.pop()) kept--;
    } else if (!VOID.has(name) && !attributes.endsWith("/")) {
      const keep = KEEP.has(name) || KEEP_CLASS.test(attributes);
      open.push(keep);
      if (keep) kept++;
    }
  }
  text(html.length);
  return out;
}
