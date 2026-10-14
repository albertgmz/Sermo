import { expect, test } from "bun:test";
import english from "../../messages/en/lib.json";
import spanish from "../../messages/es/lib.json";
import { paletteName } from "./palette-name";

const translator = (table: typeof english) => {
  const find = (key: string) =>
    key
      .split(".")
      .reduce<unknown>(
        (value, part) => (value as Record<string, unknown> | undefined)?.[part],
        table.appearance,
      );
  return Object.assign((key: string) => find(key) as string, {
    has: (key: string) => typeof find(key) === "string",
  });
};

test("a palette colour is named in the language, and an unknown one keeps its name", () => {
  expect(paletteName(translator(spanish), "nameColors", "Rose")).toBe(
    spanish.appearance.nameColors.rose,
  );
  expect(paletteName(translator(spanish), "accents", " Sky ")).toBe(
    spanish.appearance.accents.sky,
  );
  expect(paletteName(translator(english), "nameColors", "Rose")).toBe("Rose");
  expect(paletteName(translator(spanish), "nameColors", "Peach")).toBe("Peach");
  expect(paletteName(translator(spanish), "accents", "Rose")).toBe("Rose");
});
