import { Marked, type Token } from "marked";
import sanitizeHtml from "sanitize-html";
import type { Actor } from "../../actor";
import type { Ctx } from "../../context";
import type { SignatureFormat } from "../../contracts/settings";
import { ForbiddenError, ValidationError } from "../../errors";
import { markPublic } from "../../operation";
import { renderMarkdown } from "../../render";
import { evaluate, loadFacts, type Rule } from "../../shared/criteria";
import { ruleShortfall } from "../moderation/member-rules";

/** The settings a signature is judged by. */
export interface SignatureLimits {
  signatureMaxLinks: number;
  signatureMaxImages: number;
  signatureMaxSmilies: number;
  signatureMaxTextSize: number;
  signatureFormats: readonly SignatureFormat[];
}

const STRUCTURE_MESSAGE =
  "A signature is one short block: no quotes, tables, code blocks, spoilers, media or blank lines between paragraphs.";

const refuse = (message: string): never => {
  throw new ValidationError(message, [{ path: ["signature"], message }]);
};

function hasRawHtml(tokens: Token[]): boolean {
  return tokens.some((token) => {
    const children = (token as { tokens?: Token[]; items?: Token[] }).tokens ?? [];
    const items = (token as { items?: Token[] }).items ?? [];
    return token.type === "html" || hasRawHtml(children) || hasRawHtml(items);
  });
}

const LABEL: Record<SignatureFormat, string> = {
  bold: "bold text",
  italic: "italic text",
  underline: "underlined text",
  strikethrough: "strikethrough text",
  code: "inline code",
  color: "coloured text",
  font: "fonts",
  size: "text sizes",
  heading: "headings",
  link: "links",
  image: "pictures",
  list: "lists",
  align: "alignment",
};

/** What one element of the rendered signature is: a kind of formatting, or neither of the two. */
type Kind = SignatureFormat | "paragraph" | "break" | "other";

const SIZE_CLASS = /(?:^|\s)bb-size-([1-7])(?:\s|$)/;
const FONT_CLASS = /(?:^|\s)bb-font-/;
const ALIGN_CLASS = /(?:^|\s)bb-(?:left|center|right)(?:\s|$)/;
const TAG_KIND: Record<string, Kind> = {
  p: "paragraph",
  br: "break",
  strong: "bold",
  em: "italic",
  u: "underline",
  del: "strikethrough",
  s: "strikethrough",
  code: "code",
  a: "link",
  img: "image",
  ul: "list",
  ol: "list",
  li: "list",
};

function kindOf(tag: string, attribs: Record<string, string>): Kind {
  const known = TAG_KIND[tag];
  if (known)
    return tag === "a" && /(?:^|\s)mention(?:\s|$)/.test(attribs.class ?? "") ? "other" : known;
  if (/^h[1-6]$/.test(tag)) return "heading";
  const classes = attribs.class ?? "";
  if (tag === "span") {
    if (attribs.style) return "color";
    if (SIZE_CLASS.test(classes)) return "size";
    if (FONT_CLASS.test(classes)) return "font";
  }
  if (tag === "div" && ALIGN_CLASS.test(classes)) return "align";
  return "other";
}

/** The size scale of the `[size]` tag; a heading counts as 8 minus its level. */
function sizeOf(tag: string, attribs: Record<string, string>): number {
  const heading = /^h([1-6])$/.exec(tag);
  if (heading) return 8 - Number(heading[1]);
  return Number(SIZE_CLASS.exec(attribs.class ?? "")?.[1] ?? 0);
}

/**
 * What counts as one emoji: each pictograph, a flag (a pair of regional indicators), a keycap and
 * a lone skin-tone modifier. A pictograph takes its skin tone or emoji selector (U+FE0F) with it,
 * and the text-default characters that become emoji with that selector (the copyright and
 * registered signs, the trade mark, the double exclamation mark, the information source) count
 * then, not bare. A character followed by the text selector (U+FE0E) is text, unless it is an
 * emoji by default (a face, a flame): many systems have no text form for those and draw them in
 * colour anyway, so they count with any selector. A sequence joined
 * with zero-width joiners counts every pictograph in it, because a chain of joiners is not a
 * real sequence and draws separate glyphs. Strict on purpose: the symbols from U+2190 up that
 * some systems draw as colour (arrows, card suits, the sun, check marks) count even without a
 * selector.
 */
const EMOJI = new RegExp(
  [
    String.raw`\p{Regional_Indicator}{2}`,
    String.raw`[0-9#*]\uFE0F?\u20E3`,
    String.raw`(?!\p{Emoji_Modifier})\p{Emoji_Presentation}[\uFE0E\uFE0F]?\p{Emoji_Modifier}?`,
    String.raw`\p{Extended_Pictographic}\uFE0F\p{Emoji_Modifier}?`,
    String.raw`(?=[\u{2190}-\u{1FFFF}])\p{Extended_Pictographic}(?!\uFE0E)\p{Emoji_Modifier}?`,
    String.raw`\p{Emoji_Modifier}`,
  ].join("|"),
  "gu",
);

/**
 * Characters that draw nothing: spaces, controls, format characters and every default-ignorable
 * code point (zero-width and bidi marks, the soft hyphen, filler characters, variation
 * selectors, tag characters), plus the braille blank.
 */
const INVISIBLE = /[\s\p{Default_Ignorable_Code_Point}\p{Cc}\p{Cf}\u2800]/gu;

const plural = (count: number, noun: string) =>
  `${count} ${noun}${count === 1 || noun === "emoji" ? "" : "s"}`;

/**
 * The HTML of a signature. The renderer turns raw HTML into literal text, so a signature that
 * holds some is refused from the Markdown's own tokens; everything else is judged on the
 * rendered HTML, read with the sanitiser's parser, so Markdown and BB code that draw the same
 * thing count the same. Quotes, tables, code blocks, spoilers, media and more than one paragraph
 * are never allowed; each other kind of formatting is refused unless the site lists it, and the
 * links, pictures, emoji and text size are held to the site's limits (0 or -1: no limit). A
 * refusal says what is over. Mentions stay plain text (nothing resolves them here).
 */
export function renderSignature(source: string, limits: SignatureLimits): string {
  const blocks = new Marked({ gfm: true, breaks: true }).lexer(source);
  if (hasRawHtml(blocks)) refuse(STRUCTURE_MESSAGE);
  // One block: a blank line starts another (reference definitions draw nothing).
  if (blocks.filter((block) => block.type !== "space" && block.type !== "def").length > 1)
    refuse(STRUCTURE_MESSAGE);
  const html = renderMarkdown(source);
  const elements: { kind: Kind; size: number }[] = [];
  let text = "";
  sanitizeHtml(html, {
    allowedTags: [],
    allowedAttributes: {},
    transformTags: {
      "*": (tagName, attribs) => {
        elements.push({ kind: kindOf(tagName, attribs), size: sizeOf(tagName, attribs) });
        return { tagName, attribs };
      },
    },
    textFilter: (chunk) => {
      text += chunk;
      return chunk;
    },
  });
  if (
    elements.some((element) => element.kind === "other") ||
    elements.filter((element) => element.kind === "paragraph").length > 1
  )
    refuse(STRUCTURE_MESSAGE);
  // Nothing to see: no text but invisible characters, and no picture.
  if (text.replace(INVISIBLE, "") === "" && !elements.some((element) => element.kind === "image"))
    refuse("A signature must have something to show.");
  const allowed = new Set<string>(limits.signatureFormats);
  const used = new Set(elements.map((element) => element.kind));
  const refused = (Object.keys(LABEL) as SignatureFormat[]).filter(
    (format) => used.has(format) && !allowed.has(format),
  );
  if (refused.length > 0)
    refuse(`A signature cannot use ${refused.map((format) => LABEL[format]).join(", ")}.`);
  const over = (count: number, max: number, noun: string) => {
    if (max > 0 && count > max)
      refuse(`A signature may hold at most ${plural(max, noun)}; this one has ${count}.`);
  };
  over(
    elements.filter((element) => element.kind === "link").length,
    limits.signatureMaxLinks,
    "link",
  );
  over(
    elements.filter((element) => element.kind === "image").length,
    limits.signatureMaxImages,
    "picture",
  );
  over(text.match(EMOJI)?.length ?? 0, limits.signatureMaxSmilies, "emoji");
  const largest = Math.max(0, ...elements.map((element) => element.size));
  if (limits.signatureMaxTextSize > 0 && largest > limits.signatureMaxTextSize)
    refuse(
      `A signature's text may be at most size ${limits.signatureMaxTextSize}; this one uses size ${largest}.`,
    );
  return html;
}

/**
 * Refuses a member who does not hold the site's signature rule. Setting a signature is the only
 * thing it gates: clearing one is always allowed.
 */
export const requireSignatureRule = markPublic(
  "Callers require profile.signature first; this adds the site's own rule on the member's facts.",
  function requireSignatureRule(ctx: Ctx, actor: Actor, rule: Rule): void {
    const shortfall = ruleShortfall(ctx, actor, rule);
    if (!shortfall) return;
    const message = `You cannot set a signature yet. You need ${shortfall.needs}.`;
    throw new ForbiddenError(message, [{ path: ["signature"], message }]);
  },
);

/**
 * Which of these members hold the signature rule, for the signatures a page shows: one query for
 * all of them, and none when the rule is empty (everyone holds it). A signature stored by a
 * member who no longer holds the rule stays stored but is not shown.
 */
export function holdSignatureRule(ctx: Ctx, userIds: readonly number[], rule: Rule): Set<number> {
  if (rule.conditions.length === 0 || userIds.length === 0) return new Set(userIds);
  const facts = loadFacts(ctx, userIds, [rule]);
  return new Set(userIds.filter((id) => evaluate(rule, facts.get(id)!)));
}
