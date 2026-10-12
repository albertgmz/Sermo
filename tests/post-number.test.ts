import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createTranslator } from "use-intl";
import { messages } from "../src/i18n/messages";

const t = createTranslator({ locale: "en", messages }) as unknown as (
  key: string,
  values: Record<string, unknown>,
) => string;

test("a post ordinal prints without a thousands separator", () => {
  expect(t("threads.page.postNumber", { number: 1234 })).toBe("#1234");
});

test("the pages hand the ordinal over as a number, not a grouped string", () => {
  for (const page of [
    "src/app/(main)/threads/[id]/page.tsx",
    "src/app/(main)/members/[id]/page.tsx",
    "src/app/(main)/search/page.tsx",
  ])
    expect(readFileSync(page, "utf8"), page).not.toMatch(
      /formatNumber\(\s*post\.number\s*\)/,
    );
});
