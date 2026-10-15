import { expect, test } from "bun:test";
import { createTranslator } from "use-intl";
import en from "../../../messages/en/forum.json";
import es from "../../../messages/es/forum.json";

const say = (locale: "en" | "es", count: number, more: boolean) =>
  createTranslator({
    locale,
    messages: locale === "en" ? en : es,
    namespace: "infiniteList",
  })("newRows", { count, more: String(more) });

test("the bar says how many new posts there are, in both languages", () => {
  expect(say("en", 1, false)).toBe("1 new post — show");
  expect(say("en", 7, false)).toBe("7 new posts — show");
  expect(say("es", 1, false)).toBe("1 publicación nueva — mostrar");
  expect(say("es", 7, false)).toBe("7 publicaciones nuevas — mostrar");
});

test("a capped count says so", () => {
  expect(say("en", 99, true)).toBe("99+ new posts — show");
  expect(say("es", 99, true)).toBe("99+ publicaciones nuevas — mostrar");
});
