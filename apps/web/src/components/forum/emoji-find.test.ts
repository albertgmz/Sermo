import { expect, test } from "bun:test";
import type { Smilie } from "@/lib/smilies";
import {
  emojiGroups,
  emojiOfCode,
  findEmoji,
  fold,
  searchEmoji,
} from "./emoji-find";

test('":think" offers the thinking face first, by its GitHub shortcode', () => {
  expect(findEmoji("think", "es")[0]).toEqual({
    emoji: "🤔",
    code: "thinking",
    name: "cara pensativa",
  });
});

test('":pensa" finds the thinking face by its Spanish name, shown as a shortcode', () => {
  expect(findEmoji("pensa", "es")[0]).toEqual({
    emoji: "🤔",
    code: "cara_pensativa",
    name: "cara pensativa",
  });
});

test("the name is in the page's language", () => {
  expect(findEmoji("think", "en")[0].name).toBe("thinking face");
});

test("accents and capitals do not matter", () => {
  const typed = findEmoji("Corazon", "es").map((hit) => hit.emoji);
  expect(typed).toContain("❤️");
  expect(findEmoji("corazón", "es")).toEqual(findEmoji("corazon", "es"));
});

test("a shortcode that starts with what is typed comes before one that only holds it, the shortest first", () => {
  expect(findEmoji("fire", "en").map((hit) => hit.code)).toEqual([
    "fire",
    "fireworks",
    "firefighter",
    "fire_engine",
    "firecracker",
  ]);
  expect(findEmoji("sm", "en")[0].code).toBe("smile");
});

test("a Spanish keyword finds an emoji whose shortcodes do not hold it", () => {
  // 🤔's Spanish keywords are "cara", "duda" and "pensando".
  expect(findEmoji("duda", "es").map((hit) => hit.emoji)).toContain("🤔");
});

test("at most five are offered, and nothing for what nothing holds", () => {
  expect(findEmoji("a", "es")).toHaveLength(5);
  expect(findEmoji("qqzz", "es")).toEqual([]);
});

test("skin tones and regional letters are not offered on their own", () => {
  const emoji = [...findEmoji("tono", "es"), ...findEmoji("indicador", "es")];
  expect(emoji.map((hit) => hit.emoji)).not.toContain("🏻");
  expect(emoji.map((hit) => hit.emoji)).not.toContain("🇦");
});

test("a whole shortcode stands for its emoji, in English or Spanish", () => {
  expect(emojiOfCode("thinking")).toBe("🤔");
  expect(emojiOfCode("thinking_face")).toBe("🤔");
  expect(emojiOfCode("cara_pensativa")).toBe("🤔");
  expect(emojiOfCode("+1")).toBe("👍️");
  expect(emojiOfCode("fuego")).toBe("🔥");
  expect(emojiOfCode("think")).toBeUndefined();
});

test("a name folds to the shortcode it is typed as", () => {
  expect(fold("Bandera: Cuba")).toBe("bandera_cuba");
  expect(fold("corazón rojo")).toBe("corazon_rojo");
});

test("two characters offer only emoji with a word that starts with them, so emoticons and numbers open nothing", () => {
  expect(findEmoji("DD", "es")).toEqual([]);
  expect(findEmoji("pp", "es")).toEqual([]);
  expect(findEmoji("30", "es")).toEqual([]);
  expect(findEmoji("ok", "es")[0].code).toBe("ok");
  expect(findEmoji("sm", "es")[0].code).toBe("smile");
  // From three on, a shortcode that only holds what is typed is offered too.
  expect(findEmoji("ensa", "es").map((hit) => hit.emoji)).toContain("🤔");
});

const SMILIES: Smilie[] = [
  { id: 17, title: "Laugh", codes: [":LOL:"], emoji: "😆" },
  { id: 22, title: "Thumbs up", codes: ["(y)", ":like:"], emoji: "👍️" },
  { id: 4, title: "Mad", codes: [">:(", ":mad:"], emoji: "😡" },
];

test("the site's smilies are offered with the emoji, by their code or title, before the cut to five", () => {
  expect(findEmoji("lo", "es", undefined, SMILIES)[0]).toEqual({
    emoji: "😆",
    code: ":LOL:",
    name: "Laugh",
    smilie: true,
  });
  expect(findEmoji("like", "es", undefined, SMILIES)[0]).toMatchObject({
    code: ":like:",
    smilie: true,
  });
  expect(findEmoji("laugh", "en", undefined, SMILIES)[0].code).toBe(":LOL:");
  expect(findEmoji("mad", "en", undefined, SMILIES)[0].code).toBe(":mad:");
  expect(findEmoji("lo", "es", undefined, SMILIES)).toHaveLength(5);
});

test("the picker's search has no cut, and puts the smilies first", () => {
  const found = searchEmoji("cara", "es", SMILIES);
  expect(found.length).toBeGreaterThan(50);
  expect(searchEmoji("like", "es", SMILIES)[0]).toMatchObject({
    code: ":like:",
    smilie: true,
  });
});

test("the emoji come in Emojibase's groups and order, skin tones apart", () => {
  const groups = emojiGroups();
  expect(groups.map((group) => group.key)).toEqual([
    "smileys-emotion",
    "people-body",
    "animals-nature",
    "food-drink",
    "travel-places",
    "activities",
    "objects",
    "symbols",
    "flags",
  ]);
  expect(groups[0].emoji[0].emoji).toBe("😀");
  const wave = groups[1].emoji.find((item) => item.emoji === "👋");
  expect(wave?.skins).toHaveLength(5);
  expect(wave?.skins?.[0]).toBe("👋🏻");
  expect(groups.flatMap((group) => group.emoji).length).toBeGreaterThan(1800);
});

const FCUBA: Smilie[] = [
  ...SMILIES,
  { id: 6, title: "Cool", codes: [":cool:", "8-)"], emoji: "😎" },
  { id: 16, title: "Love", codes: [":love:"], emoji: "😍" },
  { id: 24, title: "Unsure", codes: [":unsure:"], emoji: "🤔" },
];
const glyph = (hits: { emoji: string }[], emoji: string) =>
  hits.filter((hit) => hit.emoji.replace(/\uFE0F/g, "") === emoji);

test("an emoji's own shortcode gives the emoji, not the smilie drawn as it", () => {
  expect(findEmoji("+1", "en", undefined, FCUBA)[0]).toEqual({
    emoji: "👍️",
    code: "+1",
    name: "thumbs up",
  });
  expect(findEmoji("thinking", "en", undefined, FCUBA)[0]).toMatchObject({
    emoji: "🤔",
    code: "thinking",
  });
  expect(findEmoji("heart_eyes", "en", undefined, FCUBA)[0]).toMatchObject({
    emoji: "😍",
    code: "heart_eyes",
  });
  expect(searchEmoji("thinking", "en", FCUBA).some((hit) => hit.smilie)).toBe(
    false,
  );
});

test("a smilie's own code or title gives the smilie once, without its emoji beside it", () => {
  const lol = findEmoji("lol", "en", undefined, FCUBA);
  expect(lol[0]).toMatchObject({ code: ":LOL:", smilie: true });
  expect(glyph(lol, "😆")).toHaveLength(1);
  const like = findEmoji("like", "en", undefined, FCUBA);
  expect(like[0]).toMatchObject({ emoji: "👍️", code: ":like:", smilie: true });
  expect(glyph(like, "👍")).toHaveLength(1);
  const cool = findEmoji("cool", "en", undefined, FCUBA);
  expect(cool[0]).toMatchObject({ emoji: "😎", code: ":cool:", smilie: true });
  expect(glyph(cool, "😎")).toHaveLength(1);
  // The emoji whose shortcode is "cool" is another one, and stays.
  expect(cool.map((hit) => hit.emoji)).toContain("🆒");
  expect(findEmoji("mad", "en", undefined, FCUBA)[0]).toMatchObject({
    code: ":mad:",
    smilie: true,
  });
});
