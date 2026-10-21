import { expect, test } from "bun:test";
import { copyText } from "@/lib/clipboard";

test("copying reports whether the clipboard took the text", async () => {
  const written: string[] = [];
  expect(
    await copyText("u", {
      clipboard: {
        writeText: async (text) => {
          written.push(text);
        },
      },
    }),
  ).toBe(true);
  expect(written).toEqual(["u"]);
  expect(await copyText("u", {})).toBe(false);
  expect(
    await copyText("u", {
      clipboard: { writeText: () => Promise.reject(new Error("no")) },
    }),
  ).toBe(false);
});
