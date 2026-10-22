import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AWARD_ICON_KEYS, ICON_KEYS } from "@sermo/core/icon-keys";
import { ICONS } from "@/components/icons/icon-set";

// The list of keys is the backend's (`modules/awards/icons.ts`), which refuses an award icon that is
// not one of them; the web app draws exactly those.
test("the backend accepts exactly the keys of the site's icon set for an award", () => {
  expect([...AWARD_ICON_KEYS].sort()).toEqual(Object.keys(ICONS).sort());
  expect([...ICON_KEYS].sort()).toEqual(Object.keys(ICONS).sort());
  expect(new Set(ICON_KEYS).size).toBe(ICON_KEYS.length);
});

test("every icon the starter awards use is one the backend accepts", () => {
  const awards = JSON.parse(
    readFileSync(
      join(import.meta.dir, "../../../scripts/starter/data/awards.json"),
      "utf8",
    ),
  ) as { icon: string }[];
  expect(awards.length).toBeGreaterThan(0);
  for (const { icon } of awards)
    expect(AWARD_ICON_KEYS.has(icon), icon).toBe(true);
});
