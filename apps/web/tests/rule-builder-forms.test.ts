import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PLACES } from "@/components/staff/criteria-rule";

// Every admin form that takes a rule draws it with the one rule builder, in the place it belongs
// to, and the rule reaches its action as one field (`rule`, or the setting's own name where a form
// holds two) that the shared helper reads.
const admin = decodeURIComponent(
  new URL(
    "../src/app/[locale]/(staff)/admin",
    import.meta.url,
  ).pathname.replace(/^\/(?=[a-z]:)/i, ""),
);
const read = (path: string) => readFileSync(join(admin, path), "utf8");

const FORMS = {
  promotion: ["promotions/promotion-form.tsx", "promotions/actions.ts"],
  award: ["awards/award-form.tsx", "awards/actions.ts"],
  notice: ["notices/notice-fields.tsx", "notices/actions.ts"],
  shopCategory: [
    "shop/categories/category-screen.tsx",
    "shop/categories/actions.ts",
  ],
  shopItem: ["shop/items/item-form.tsx", "shop/items/actions.ts"],
  reactionType: ["reactions/access-fields.tsx", "reactions/actions.ts"],
  postLinks: ["settings/antispam/antispam-form.tsx", "settings/actions.ts"],
  postApproval: ["settings/antispam/antispam-form.tsx", "settings/actions.ts"],
} as const;

test("there is a form for every place a rule is edited", () => {
  expect(Object.keys(FORMS).sort()).toEqual(Object.keys(PLACES).sort());
});

test("each form draws its rule with the builder, in its own place", () => {
  for (const [place, [form]] of Object.entries(FORMS))
    expect(read(form)).toMatch(
      new RegExp(String.raw`<RuleField\s+place="${place}"`),
    );
});

test("each action reads the rule with the shared helper", () => {
  for (const [, [, action]] of Object.entries(FORMS)) {
    const source = read(action);
    expect(source).toContain("ruleOf(formData");
    expect(source).not.toMatch(/rule:kept|rule:match|use:|value:/);
  }
});

test("no screen draws a rule any other way", () => {
  const files = (dir: string): string[] =>
    readdirSync(join(admin, dir), { withFileTypes: true }).flatMap((entry) => {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) return files(path);
      return /\.tsx?$/.test(entry.name) && !/\.test\./.test(entry.name)
        ? [path]
        : [];
    });
  for (const file of files(".")) {
    const source = read(file);
    expect(source).not.toContain("CriteriaFields");
    expect(source).not.toContain("rule:kept");
  }
});
