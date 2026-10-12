import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Standing } from "@/app/(staff)/registry";
import { accentCss } from "@/components/layout/site-accent";
import { staffLinks } from "@/components/layout/staff-bar";

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

test("the staff bar links the panel when it holds something and moderation when a moderation screen opens", () => {
  const standing = (
    resolvedPermissions: Record<string, boolean | number>,
    staff: Partial<Standing["staff"]> = {},
  ): Standing => ({
    resolvedPermissions,
    staff: {
      panel: false,
      moderatesEverywhere: false,
      moderatedNodeIds: [],
      ...staff,
    },
  });
  expect(staffLinks(standing({}))).toEqual({ admin: false, moderation: false });
  // Granted permissions of other kinds, or a limit, are no staff work.
  expect(
    staffLinks(standing({ "forum.reply": true, "admin.groups": false })),
  ).toEqual({ admin: false, moderation: false });
  expect(
    staffLinks(standing({ "admin.announcements": true }, { panel: true })),
  ).toEqual({ admin: true, moderation: false });
  // A moderator of one forum has no global flag: the staff summary shows them.
  expect(
    staffLinks(standing({}, { panel: true, moderatedNodeIds: [3] })),
  ).toEqual({ admin: true, moderation: true });
  expect(
    staffLinks(standing({}, { panel: true, moderatesEverywhere: true })),
  ).toEqual({ admin: true, moderation: true });
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
