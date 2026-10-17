import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ACCENT_FLOOR,
  brandOf,
  CARD_COLOURS,
  type CardContent,
  cardKey,
  cardOf,
  cardPath,
  clampText,
  contrast,
  drawable,
  planCard,
  TITLE_LINES,
  TITLE_MAX,
  titleLayout,
} from "./card";
import { codePointsOf } from "./font-coverage";

const SITE = { name: "Garden Club", icon: null, accents: [] };
const covered = new Set(
  ["InterDisplay-Bold.ttf", "Inter-SemiBold.ttf", "Inter-Regular.ttf"].flatMap(
    (file) => [
      ...codePointsOf(readFileSync(join(process.cwd(), "assets/og", file))),
    ],
  ),
);
const covers = (code: number) => covered.has(code);
const TRAIL = {
  "@type": "BreadcrumbList",
  itemListElement: [{ name: "Garden" }, { name: "Roses" }],
};
const POST = {
  "@type": "DiscussionForumPosting",
  headline: "Pruning roses",
  author: { "@type": "Person", name: "wren" },
};
const PROFILE = {
  "@type": "ProfilePage",
  mainEntity: { name: "wren", description: "Grows roses." },
};

test("a long title is cut at a word to what three lines of the smallest size hold", () => {
  const title =
    "¿Cuál es la mejor época del año para podar los rosales trepadores en climas mediterráneos con veranos secos y muy calurosos? Opiniones";
  const layout = titleLayout(title);
  expect(layout.lines).toBe(TITLE_LINES);
  expect(Array.from(layout.text).length).toBeLessThanOrEqual(TITLE_MAX);
  // Cut after a word that carries meaning, not after "con".
  expect(layout.text).toEndWith("con veranos…");
  expect(title.startsWith(layout.text.slice(0, -1))).toBe(true);
  // The longer the title, the smaller it is drawn; a short one is not cut.
  const short = titleLayout("Pruning roses");
  expect(short.text).toBe("Pruning roses");
  expect(short.fontSize).toBeGreaterThan(layout.fontSize);
  expect(titleLayout("x".repeat(60)).fontSize).toBeLessThan(short.fontSize);
});

test("a cut drops the punctuation it ends on, and a word with no space near the cut is split", () => {
  expect(clampText("Roses, beans, and more", 15)).toBe("Roses, beans…");
  expect(clampText("a".repeat(30), 10)).toBe(`${"a".repeat(9)}…`);
  expect(clampText("Short", 10)).toBe("Short");
  // A short word left at the cut goes with it.
  expect(clampText("Pruning old roses for the garden", 28)).toBe(
    "Pruning old roses…",
  );
});

test("the card keeps what its fonts draw: Spanish, Greek and Cyrillic, not emoji or other scripts", () => {
  expect(drawable("¿Año nuevo? ¡Sí, señor! Ünïcødé", covers)).toBe(
    "¿Año nuevo? ¡Sí, señor! Ünïcødé",
  );
  expect(drawable("Привет мир — Γειά σου", covers)).toBe(
    "Привет мир — Γειά σου",
  );
  // A decomposed accent is drawn as the letter it makes.
  expect(drawable("Jardín", covers)).toBe("Jardín");
  // Emoji go; a letter the fonts lack takes the whole text with it, rather than draw part of it.
  expect(drawable("Rosas 🌹 ok ✌🏽", covers)).toBe("Rosas ok");
  expect(drawable("Python 教程", covers)).toBe("");
  expect(drawable("Rosas 日本語 العربية", covers)).toBe("");
  expect(drawable("👨‍👩‍👧 🏳️‍🌈", covers)).toBe("");
});

test("a thread's card says its title, its forum and who started it", () => {
  expect(cardOf("threads", { description: "", jsonLd: [POST, TRAIL] })).toEqual(
    {
      kind: "threads",
      title: "Pruning roses",
      forum: "Roses",
      author: "wren",
    },
  );
  // Without the posting (its text closed to the reader) there is no card to name.
  expect(cardOf("threads", { description: "", jsonLd: [TRAIL] })).toBeNull();
});

test("a forum's card says its name, the forums above it and its description; a member's their name and about", () => {
  expect(
    cardOf("forums", { description: "All about roses.", jsonLd: [TRAIL] }),
  ).toEqual({
    kind: "forums",
    title: "Roses",
    parents: ["Garden"],
    description: "All about roses.",
  });
  expect(cardOf("forums", { description: "", jsonLd: [] })).toBeNull();
  expect(cardOf("members", { description: "", jsonLd: [PROFILE] })).toEqual({
    kind: "members",
    title: "wren",
    description: "Grows roses.",
  });
  expect(cardOf("members", { description: "", jsonLd: [POST] })).toBeNull();
});

test("the key follows everything the card shows", () => {
  const content: CardContent = {
    kind: "threads",
    title: "Pruning roses",
    forum: "Roses",
    author: "wren",
  };
  const brand = brandOf(SITE);
  const key = cardKey(content, brand);
  expect(key).toMatch(/^[\w-]{16}$/);
  expect(cardKey({ ...content }, brandOf(SITE))).toBe(key);
  for (const other of [
    cardKey({ ...content, title: "Pruning old roses" }, brand),
    cardKey(content, { ...brand, name: "Garden Club!" }),
    cardKey(content, { ...brand, accent: "#2563eb" }),
    cardKey(content, { ...brand, icon: { fileId: 6, url: "/api/v1/files/6" } }),
  ])
    expect(other).not.toBe(key);
  expect(cardPath(content, 12, brand)).toBe(`/og/threads/12?v=${key}`);
  const site: CardContent = {
    kind: "site",
    title: "Garden Club",
    description: "",
  };
  expect(cardPath(site, null, brand)).toStartWith("/og/site?v=");
});

test("the accent is the palette's first, and only a #rrggbb colour is drawn", () => {
  const accent = (color: string, foreground: string | null) =>
    brandOf({ ...SITE, accents: [{ color, foreground }] });
  expect(brandOf(SITE)).toEqual({
    name: "Garden Club",
    accent: "#dc2626",
    onAccent: "#ffffff",
    icon: null,
  });
  expect(accent("#fbbf24", "#000000")).toMatchObject({
    accent: "#fbbf24",
    onAccent: "#000000",
  });
  // Black does not read on this blue: the letter on it turns white.
  expect(accent("#2563eb", "#000000")).toMatchObject({
    accent: "#2563eb",
    onAccent: "#ffffff",
  });
  expect(accent("#2563eb", null).onAccent).toBe("#ffffff");
  expect(accent("red;background:url(x)", "#000000")).toMatchObject({
    accent: "#dc2626",
    onAccent: "#ffffff",
  });
});

test("an accent too close to the card's dark parts is drawn lighter, and the letter on it still reads", () => {
  const dark = brandOf({
    ...SITE,
    accents: [{ color: "#1a1a22", foreground: "#ffffff" }],
  });
  expect(dark.accent).not.toBe("#1a1a22");
  expect(contrast(dark.accent, CARD_COLOURS.raised)).toBeGreaterThanOrEqual(
    ACCENT_FLOOR,
  );
  expect(contrast(dark.onAccent, dark.accent)).toBeGreaterThanOrEqual(4.5);
  const black = brandOf({
    ...SITE,
    accents: [{ color: "#000000", foreground: null }],
  });
  expect(contrast(black.accent, CARD_COLOURS.raised)).toBeGreaterThanOrEqual(
    ACCENT_FLOOR,
  );
  // An accent that stands out already is drawn as chosen.
  expect(brandOf(SITE).accent).toBe("#dc2626");
});

test("a title the fonts cannot draw is not drawn: the forum's name heads the card instead", () => {
  const brand = brandOf(SITE);
  const thread = (title: string, forum = "Roses", author = "wren") =>
    planCard({ kind: "threads", title, forum, author }, brand, covers);
  expect(thread("Pruning roses")).toEqual({
    layout: "page",
    site: "Garden Club",
    headline: "Pruning roses",
    chip: "Roses",
    author: { name: "wren", initial: "W" },
    description: "",
  });
  // A Chinese, Japanese or Korean title, or one of emoji alone.
  for (const title of ["日本のバラの剪定について", "玫瑰修剪", "🌹🌹🌹"])
    expect(thread(title)).toMatchObject({
      layout: "page",
      headline: "Roses",
      chip: "",
      author: { name: "wren", initial: "W" },
    });
  // An Arabic title in an Arabic forum: nothing of the page can be drawn, the site's card is.
  expect(thread("تقليم الورد", "الورود")).toEqual({
    layout: "site",
    site: "Garden Club",
    description: "",
  });
  // A starter whose name cannot be drawn is left out.
  expect(thread("Pruning roses", "Roses", "佐藤")).toMatchObject({
    layout: "page",
    author: null,
  });
});

test("a member or forum whose name cannot be drawn gets the generic mark, or the site's card", () => {
  const brand = brandOf(SITE);
  expect(
    planCard(
      { kind: "members", title: "佐藤花子", description: "Rosas y tomates." },
      brand,
      covers,
    ),
  ).toEqual({
    layout: "member",
    site: "Garden Club",
    member: { name: "", initial: "" },
    description: "Rosas y tomates.",
  });
  expect(
    planCard(
      { kind: "members", title: "wren", description: "" },
      brand,
      covers,
    ),
  ).toMatchObject({ member: { name: "wren", initial: "W" } });
  expect(
    planCard(
      {
        kind: "forums",
        title: "バラ",
        parents: ["Garden"],
        description: "All about roses.",
      },
      brand,
      covers,
    ),
  ).toEqual({ layout: "site", site: "Garden Club", description: "" });
  // A forum above it that cannot be drawn drops the chip, not the card.
  expect(
    planCard(
      {
        kind: "forums",
        title: "Roses",
        parents: ["庭"],
        description: "All about roses.",
      },
      brand,
      covers,
    ),
  ).toMatchObject({ layout: "page", headline: "Roses", chip: "" });
});
