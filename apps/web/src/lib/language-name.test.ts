import { expect, test } from "bun:test";
import { languageName } from "./language-name";

test("a language is named in itself, first letter in capitals", () => {
  expect(languageName("en")).toBe("English");
  expect(languageName("es")).toBe("Español");
});
