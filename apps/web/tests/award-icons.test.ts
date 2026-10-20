import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ICONS } from "@/components/icons/icon-set";
import { AWARD_ICON_KEYS } from "../../../packages/core/src/modules/awards/icons";

// The backend refuses an award icon that is not a key of the site's icon set, so it holds a copy
// of the set. A key added to the set must be added to that copy (`modules/awards/icons.ts`).
test("the backend accepts exactly the keys of the site's icon set for an award", () => {
  expect([...AWARD_ICON_KEYS].sort()).toEqual(Object.keys(ICONS).sort());
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
