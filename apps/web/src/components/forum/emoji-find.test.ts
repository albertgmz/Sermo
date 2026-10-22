import { expect, test } from "bun:test";
import { emojiOfCode, findEmoji, fold } from "./emoji-find";

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
