import { createHash } from "node:crypto";
import * as z from "zod";
import { isHexColor } from "@/lib/css-color";

// The share card of a page: a 1200 x 630 picture that a chat app or a social site shows with a
// shared link. What it says is taken from what the backend says about the page to a search
// engine (its SEO read), so the page that names a card and the route that draws it read the same
// words from the same kind of answer.

export const CARD_SIZE = { width: 1200, height: 630 } as const;
export const CARD_TYPE = "image/png";

// Raised when the drawing changes, so every card gets a new address.
const DESIGN = 1;

// The pages that have a card of their own, by the first segment of their address.
export const CARD_KINDS = ["threads", "forums", "members"] as const;
export type CardKind = (typeof CARD_KINDS)[number];
export const isCardKind = (value: string): value is CardKind =>
  (CARD_KINDS as readonly string[]).includes(value);

export type CardContent =
  | { kind: "site"; title: string; description: string }
  | { kind: "threads"; title: string; forum: string; author: string }
  | { kind: "forums"; title: string; parents: string[]; description: string }
  | { kind: "members"; title: string; description: string };

// The site as every card shows it: its name, its accent (the first of the palette) with the
// colour of text on it, and its icon when one was uploaded (a PNG).
export type CardBrand = {
  name: string;
  accent: string;
  onAccent: string;
  icon: { fileId: number; url: string } | null;
};

// The default accent and the text on it, as globals.css has them.
const DEFAULT_ACCENT = "#dc2626";
const DEFAULT_ON_ACCENT = "#ffffff";

export function brandOf(site: {
  name: string;
  icon: { fileId: number; url: string } | null;
  accents: { color: string; foreground: string | null }[];
}): CardBrand {
  const accent = site.accents[0];
  const color = isHexColor(accent?.color) ? accent.color : DEFAULT_ACCENT;
  return {
    name: site.name,
    accent: color,
    onAccent:
      color === accent?.color && isHexColor(accent.foreground)
        ? accent.foreground
        : DEFAULT_ON_ACCENT,
    icon: site.icon ? { fileId: site.icon.fileId, url: site.icon.url } : null,
  };
}

export const siteContent = (site: {
  name: string;
  description: string;
}): CardContent => ({
  kind: "site",
  title: site.name,
  description: site.description,
});

// The parts of the structured data a card reads. The backend writes it for search engines; a part
// that is missing or of another shape gives no card.
const Named = z.object({ name: z.string() });
const Breadcrumb = z.object({
  "@type": z.literal("BreadcrumbList"),
  itemListElement: z.array(Named).min(1),
});
const Posting = z.object({
  "@type": z.literal("DiscussionForumPosting"),
  headline: z.string(),
  author: Named,
});
const Profile = z.object({
  "@type": z.literal("ProfilePage"),
  mainEntity: Named.extend({ description: z.string().optional() }),
});

function itemOf<T>(schema: z.ZodType<T>, items: unknown[]): T | undefined {
  for (const item of items) {
    const parsed = schema.safeParse(item);
    if (parsed.success) return parsed.data;
  }
  return undefined;
}

// What the card of a thread, forum or member says, from the page's SEO read: the thread's title,
// its forum and the member who started it; the forum's name, the forums above it and its
// description; the member's name and what they say about themselves. Null when the read does not
// carry it (the structured data of a page closed to guests leaves it out).
export function cardOf(
  kind: CardKind,
  seo: { description: string; jsonLd: unknown[] },
): CardContent | null {
  const trail = itemOf(Breadcrumb, seo.jsonLd)?.itemListElement.map(
    (item) => item.name,
  );
  if (kind === "threads") {
    const posting = itemOf(Posting, seo.jsonLd);
    const forum = trail?.at(-1);
    if (!posting || forum === undefined) return null;
    return {
      kind,
      title: posting.headline,
      forum,
      author: posting.author.name,
    };
  }
  if (kind === "forums") {
    if (!trail) return null;
    return {
      kind,
      title: trail[trail.length - 1],
      parents: trail.slice(0, -1),
      description: seo.description,
    };
  }
  const profile = itemOf(Profile, seo.jsonLd);
  if (!profile) return null;
  return {
    kind,
    title: profile.mainEntity.name,
    description: profile.mainEntity.description ?? "",
  };
}

// A short name for everything a card shows: a renamed thread, a new accent or icon, or a new
// drawing gives the card a new address, so the old picture can be kept for long wherever it is.
export function cardKey(content: CardContent, brand: CardBrand): string {
  return createHash("sha256")
    .update(JSON.stringify([DESIGN, content, brand]))
    .digest("base64url")
    .slice(0, 16);
}

// The card's path on this app (app/og, outside the language segment), with its key.
export function cardPath(
  content: CardContent,
  id: number | null,
  brand: CardBrand,
): string {
  const path =
    content.kind === "site" || id === null
      ? "/og/site"
      : `/og/${content.kind}/${id}`;
  return `${path}?v=${cardKey(content, brand)}`;
}

// The fonts of the card cover Latin, Greek and Cyrillic. A character none of them has would make
// the renderer download a font (from Google) or an emoji picture while it draws; such characters
// are left out of the card instead, and the page's own text keeps them. `covers` is the set of
// code points the fonts have.
const PICTOGRAPH = /\p{Extended_Pictographic}|\p{Emoji_Modifier}|[‍︎️]/u;

export function drawable(text: string, covers: (codePoint: number) => boolean) {
  let kept = "";
  for (const char of text.normalize("NFC")) {
    const codePoint = char.codePointAt(0) ?? 0;
    if (PICTOGRAPH.test(char)) continue;
    if (/\s/.test(char)) kept += " ";
    else if (covers(codePoint)) kept += char;
  }
  return kept.replace(/ {2,}/g, " ").trim();
}

// Text cut to at most `max` characters, at a word when one ends near the cut, with an ellipsis.
export function clampText(text: string, max: number): string {
  const chars = Array.from(text);
  if (chars.length <= max) return text;
  const cut = chars.slice(0, max - 1).join("");
  const space = cut.lastIndexOf(" ");
  const word = space >= max * 0.6 ? cut.slice(0, space) : cut;
  return `${word.replace(/[\s.,;:!?¿¡-]+$/u, "")}…`;
}

// The headline of a card: shorter titles are drawn larger, and a long one is cut to what three
// lines of the smallest size hold. `lines` is the most it may take; the renderer clamps there too.
export const TITLE_LINES = 3;
const TITLE_SIZES = [
  { upTo: 28, size: 84 },
  { upTo: 56, size: 72 },
  { upTo: 84, size: 62 },
] as const;
const TITLE_SMALLEST = 54;
export const TITLE_MAX = 100;

export function titleLayout(title: string) {
  const length = Array.from(title).length;
  const step = TITLE_SIZES.find((item) => length <= item.upTo);
  return {
    text: clampText(title, TITLE_MAX),
    fontSize: step?.size ?? TITLE_SMALLEST,
    lines: TITLE_LINES,
  };
}

// The line under a forum's or member's name, or the site's: two lines at the most.
export const DESCRIPTION_MAX = 150;
