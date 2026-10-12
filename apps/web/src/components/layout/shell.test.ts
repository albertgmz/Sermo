import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { accentCss } from "@/components/layout/site-accent";
import { hasStaffWork } from "@/components/layout/staff-bar";

const none = { isModerator: false };

test("an accent becomes the two custom properties on the root", () => {
  expect(accentCss({ color: "#0ea5e9", foreground: "#03131f" })).toBe(
    ":root{--primary:#0ea5e9;--primary-foreground:#03131f;}",
  );
  expect(accentCss({ color: "#0EA5E9", foreground: null })).toBe(
    ":root{--primary:#0EA5E9;}",
  );
});

test("no accent, or a colour that is not #rrggbb, leaves the stylesheet's own", () => {
  expect(accentCss(null)).toBeNull();
  for (const color of ["red", "#fff", "#12345g", "red;}body{display:none"])
    expect(accentCss({ color, foreground: null })).toBeNull();
  expect(
    accentCss({ color: "#0ea5e9", foreground: "}body{display:none" }),
  ).toBe(":root{--primary:#0ea5e9;}");
});

test("staff work is a moderator or any administration permission that is granted", () => {
  expect(hasStaffWork({ permissions: none, resolvedPermissions: {} })).toBe(
    false,
  );
  expect(
    hasStaffWork({
      permissions: none,
      resolvedPermissions: { "forum.reply": true, "admin.groups": false },
    }),
  ).toBe(false);
  // A number is a limit, not a grant.
  expect(
    hasStaffWork({
      permissions: none,
      resolvedPermissions: { "admin.uploadLimit": 5 },
    }),
  ).toBe(false);
  expect(
    hasStaffWork({
      permissions: none,
      resolvedPermissions: { "admin.forums": true },
    }),
  ).toBe(true);
  expect(
    hasStaffWork({
      permissions: { isModerator: true },
      resolvedPermissions: {},
    }),
  ).toBe(true);
});

test("the shell reads the viewer from the backend, never from the JSON data", () => {
  const sources = [
    join(import.meta.dir, "../../app/(main)/layout.tsx"),
    ...readdirSync(import.meta.dir)
      .filter((name) => /\.tsx?$/.test(name) && !name.endsWith(".test.ts"))
      .map((name) => join(import.meta.dir, name)),
  ];
  for (const file of sources)
    expect(readFileSync(file, "utf8"), file).not.toMatch(
      /from "@\/lib\/(db|session)"/,
    );
});
