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
const DESIGN = 2;

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

// The card is drawn in the dark theme's colours, outside any stylesheet: the surface, the raised
// parts (the mark's tile, the chip), the hairline at the edges and the two text colours.
export const CARD_COLOURS = {
  surface: "#111114",
  raised: "#1c1c21",
  edge: "#2e2e35",
  ink: "#fafafa",
  muted: "#b4b4bc",
} as const;

// The default accent, as globals.css has it.
const DEFAULT_ACCENT = "#dc2626";
const WHITE = "#ffffff";

const channels = (hex: string) =>
  [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));

function luminance(hex: string) {
  const [r, g, b] = channels(hex).map((value) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// The WCAG contrast ratio of two #rrggbb colours.
export function contrast(a: string, b: string) {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}

function towardWhite(hex: string, share: number) {
  return `#${channels(hex)
    .map((value) =>
      Math.round(value + (255 - value) * share)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

// The accent marks the card (the bar, the dot, the drawn mark, the member's circle) and must stand
// apart from the raised parts it sits next to: an accent too dark for that is lightened until it
// does.
export const ACCENT_FLOOR = 2;

function visibleAccent(color: string) {
  for (let step = 0; step < 10; step++) {
    const tint = towardWhite(color, step / 10);
    if (contrast(tint, CARD_COLOURS.raised) >= ACCENT_FLOOR) return tint;
  }
  return WHITE;
}

// The letter on the accent: the palette's colour for it while it reads there, else white or the
// card's surface, whichever stands out more.
function textOn(accent: string, wanted: string) {
  if (contrast(wanted, accent) >= 4.5) return wanted;
  return contrast(WHITE, accent) >= contrast(CARD_COLOURS.surface, accent)
    ? WHITE
    : CARD_COLOURS.surface;
}

export function brandOf(site: {
  name: string;
  icon: { fileId: number; url: string } | null;
  accents: { color: string; foreground: string | null }[];
}): CardBrand {
  const first = site.accents[0];
  const chosen = isHexColor(first?.color) ? first.color.toLowerCase() : null;
  const accent = visibleAccent(chosen ?? DEFAULT_ACCENT);
  const foreground =
    chosen && isHexColor(first?.foreground) ? first.foreground : WHITE;
  return {
    name: site.name,
    accent,
    onAccent: textOn(accent, foreground.toLowerCase()),
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
// the renderer download a font (from Google) or an emoji picture while it draws, so nothing the
// fonts lack is drawn: emoji and symbols are left out, and a text with a letter or digit the fonts
// lack is not drawn at all (an empty string), since part of a title or name would misstate it.
// The page itself, og:title and the picture's alt text keep the whole text. `covers` says which
// code points the fonts have.
const PICTOGRAPH = /\p{Extended_Pictographic}|\p{Emoji_Modifier}|[‍︎️]/u;
const WORDLIKE = /[\p{L}\p{N}\p{M}]/u;

export function drawable(text: string, covers: (codePoint: number) => boolean) {
  let kept = "";
  for (const char of text.normalize("NFC")) {
    if (PICTOGRAPH.test(char)) continue;
    if (/\s/.test(char)) kept += " ";
    else if (covers(char.codePointAt(0) ?? 0)) kept += char;
    else if (WORDLIKE.test(char)) return "";
  }
  return kept.replace(/ {2,}/g, " ").trim();
}

// Text cut to at most `max` characters, at a word when one ends near the cut, with an ellipsis.
// Short words left at the end of the cut ("con", "de", "for the") go too: they read as dangling.
export function clampText(text: string, max: number): string {
  const chars = Array.from(text);
  if (chars.length <= max) return text;
  let cut = chars.slice(0, max - 1).join("");
  const space = cut.lastIndexOf(" ");
  if (space >= max * 0.6) {
    cut = cut.slice(0, space);
    let last = cut.lastIndexOf(" ");
    while (last >= max * 0.6 && Array.from(cut.slice(last + 1)).length <= 3) {
      cut = cut.slice(0, last);
      last = cut.lastIndexOf(" ");
    }
  }
  return `${cut.replace(/[\s.,;:!?¿¡-]+$/u, "")}…`;
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
export const TITLE_MAX = 108;

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
const DESCRIPTION_MAX = 120;

// What a card draws, from what it says and what its fonts can draw:
// - "page": a thread (its title, its forum on a chip, who started it) or a forum (its name, the
//   forums above it, its description). A thread title the fonts cannot draw gives way to the
//   forum's name; a forum's name, or a thread with neither, gives the site's card. A thread's
//   starter whose name the fonts cannot draw is left out (a nameless circle says nothing there).
// - "member": the member's name with their initial on the accent; a name the fonts cannot draw is
//   left out and the circle holds the generic member mark.
// - "site": the site's name and description under its mark.
// `site` is the site's name for the card, "" when the fonts cannot draw it.
export type CardPerson = { name: string; initial: string };
export type CardPlan =
  | { layout: "site"; site: string; description: string }
  | {
      layout: "page";
      site: string;
      headline: string;
      chip: string;
      author: CardPerson | null;
      description: string;
    }
  | { layout: "member"; site: string; member: CardPerson; description: string };

// The first letter or digit of a name, as the circle shows it; "" when there is none.
function initialOf(name: string) {
  const first = Array.from(name).find((char) => /[\p{L}\p{N}]/u.test(char));
  return first?.toLocaleUpperCase() ?? "";
}

export function planCard(
  content: CardContent,
  brand: CardBrand,
  covers: (codePoint: number) => boolean,
): CardPlan {
  const draw = (text: string) => drawable(text, covers);
  const describe = (text: string) => clampText(draw(text), DESCRIPTION_MAX);
  const site = clampText(draw(brand.name), 40);
  const siteCard: CardPlan = {
    layout: "site",
    site,
    description: content.kind === "site" ? describe(content.description) : "",
  };
  switch (content.kind) {
    case "site":
      return siteCard;
    case "threads": {
      const title = draw(content.title);
      const forum = draw(content.forum);
      const author = draw(content.author);
      if (!title && !forum) return siteCard;
      return {
        layout: "page",
        site,
        headline: title || forum,
        chip: title ? clampText(forum, 36) : "",
        author: author
          ? { name: clampText(author, 28), initial: initialOf(author) }
          : null,
        description: "",
      };
    }
    case "forums": {
      const title = draw(content.title);
      if (!title) return siteCard;
      const parents = content.parents.map(draw);
      return {
        layout: "page",
        site,
        headline: title,
        chip: parents.every(Boolean) ? clampText(parents.join(" / "), 48) : "",
        author: null,
        description: describe(content.description),
      };
    }
    case "members": {
      const name = draw(content.title);
      return {
        layout: "member",
        site,
        member: { name, initial: initialOf(name) },
        description: describe(content.description),
      };
    }
  }
}
