import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  type BudgetFile,
  checkBudgets,
  formatReport,
  measureRoutes,
} from "./js-budget-lib";

// Usage (from apps/web, after `next build`): bun scripts/js-budget.ts [--all]
// Reads .next and js-budgets.json, prints gzip client JavaScript per budget group and exits 1 when
// a route is over its budget. `--all` lists every route with its size, to set or revise the budgets.

function fail(message: string): never {
  console.error(`js-budget: ${message}`);
  process.exit(1);
}

function budgets(path: string): BudgetFile {
  let file: BudgetFile;
  try {
    file = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(
      `cannot read ${path}: ${error instanceof Error ? error.message : error}`,
    );
  }
  if (!Array.isArray(file.budgets)) fail(`${path} has no "budgets" list`);
  return file;
}

let routes: ReturnType<typeof measureRoutes>;
try {
  routes = measureRoutes(resolve(".next"));
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
const file = budgets(resolve("js-budgets.json"));
if (process.argv.includes("--all")) {
  for (const r of routes)
    console.log(`${String(r.bytes).padStart(8)}  ${r.route}`);
}
const result = checkBudgets(routes, file);
console.log(formatReport(result));
process.exit(result.ok ? 0 : 1);
