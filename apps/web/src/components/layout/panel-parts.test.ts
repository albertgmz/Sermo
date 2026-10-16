import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (file: string) =>
  readFileSync(resolve(import.meta.dir, file), "utf8");

test("the parts list holds the client component the alerts rows draw", () => {
  expect(read("../forum/notification-row.tsx")).toContain(
    "notifications/notification-link",
  );
  const parts = read("panel-parts.ts");
  expect(parts).toContain("notifications/notification-link");
  expect(parts).toMatch(/Object\.freeze\(\[[^\]]*\bNotificationLink\b/);
});

test("the account menu, which every page with the menu renders, imports the list", () => {
  expect(read("account-menu.tsx")).toContain(
    '"@/components/layout/panel-parts"',
  );
});

test("the alerts rows are drawn by a server action, which is why the list is needed", () => {
  const action = read("panel-actions.tsx");
  expect(action).toMatch(/^"use server"/);
  expect(action).toContain("AlertRows");
});
