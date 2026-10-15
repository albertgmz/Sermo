import { expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { Award } from "../contracts/awards";
import { CriteriaRule, NonEmptyCriteriaRule } from "../contracts/criteria";
import { NoticeDetail } from "../contracts/notices";
import { Promotion, promotionsCreate } from "../contracts/promotions";
import { ShopCategory, ShopItem } from "../contracts/shop";
import { EMPTY_RULE } from "../db/schema";
import { createTestContext } from "../testing";

const src = join(import.meta.dir, "..");
const read = (path: string) => readFileSync(join(src, path), "utf8");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return name.endsWith(".ts") && !name.endsWith(".test.ts") ? [path] : [];
  });
}

/** Where a rule is stored and decided: the consumers of the engine. */
const consumers = [
  "modules/promotions/index.ts",
  "modules/awards/automatic.ts",
  "modules/notices/index.ts",
  "modules/shop/audience.ts",
];

test("every consumer decides a rule only by calling the engine's evaluate", () => {
  for (const file of consumers) {
    const source = read(file);
    expect(source, file).toMatch(/from "\.\.\/\.\.\/shared\/criteria"/);
    expect(source, file).toMatch(/\bevaluate\b/);
  }
});

test("nothing outside the engine reads a condition's criterion", () => {
  const engine = join(src, "shared", "criteria");
  const offenders = sources(src)
    .filter((file) => file !== `${engine}.ts` && !file.startsWith(`${engine}${sep}`))
    .filter((file) =>
      /\.criterion\b|\bcriterion\s*===|case "post_count"/.test(readFileSync(file, "utf8")),
    )
    .map((file) => relative(src, file));
  expect(offenders).toEqual([]);
});

test("the old per-consumer decision code is gone", () => {
  const engine = read("shared/criteria.ts");
  const old = /\beligible\(|attachPurchasedItems|CRITERIA_USER_COLUMNS/;
  const offenders = sources(src)
    .filter((file) => old.test(readFileSync(file, "utf8")))
    .map((file) => relative(src, file));
  expect(offenders).toEqual([]);
  expect(engine).toContain("export function evaluate(");
});

test("every consumer's contract takes and returns the one shared rule schema", () => {
  expect(Award.shape.rule).toBe(CriteriaRule);
  expect(NoticeDetail.shape.rule).toBe(CriteriaRule);
  expect(ShopCategory.shape.rule).toBe(CriteriaRule);
  expect(ShopItem.shape.rule).toBe(CriteriaRule);
  expect(Promotion.shape.rule).toBe(CriteriaRule);
  expect(promotionsCreate.input.shape.rule).toBe(NonEmptyCriteriaRule);
});

test("every consumer stores its rule in a `rule` column that defaults to everyone", () => {
  const ctx = createTestContext();
  for (const table of ["promotions", "awards", "notices", "shop_categories", "shop_items"]) {
    const column = ctx.sqlite
      .prepare<{ dflt_value: string; type: string }, [string]>(
        "SELECT dflt_value, type FROM pragma_table_info(?1) WHERE name = 'rule'",
      )
      .get(table);
    expect(column, table).toEqual({ dflt_value: `'${EMPTY_RULE}'`, type: "TEXT" });
  }
});
