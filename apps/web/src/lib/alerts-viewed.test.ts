import { afterEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { itemChanges, shownValue } from "@/lib/item-state";
import { viewAlerts } from "./alerts-viewed";
import { rememberDrawn } from "./counters";

afterEach(() => itemChanges.clear());

const badge = (drawn: number) =>
  shownValue(itemChanges.get("counter:notifications") as never, drawn);

test("opening the alerts empties the badge where it is drawn, without a new page", async () => {
  rememberDrawn({ conversations: 2, notifications: 3 });
  let asked = 0;
  await viewAlerts(async () => {
    asked += 1;
    return true;
  });
  expect(asked).toBe(1);
  expect(badge(3)).toBe(0);
  // The messages badge is not touched.
  expect(shownValue(itemChanges.get("counter:conversations") as never, 2)).toBe(
    2,
  );
});

test("a refused or failed request leaves the badge as it was", async () => {
  rememberDrawn({ conversations: 0, notifications: 3 });
  await viewAlerts(async () => false);
  expect(badge(3)).toBe(3);
});

test("the module reloads nothing: no router, no revalidation", () => {
  const source = readFileSync(
    new URL("./alerts-viewed.ts", import.meta.url),
    "utf8",
  );
  expect(source).not.toMatch(/router|refresh|revalidate/);
});
