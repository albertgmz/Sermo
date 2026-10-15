import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  type BudgetFile,
  checkBudgets,
  formatReport,
  measureRoutes,
} from "./js-budget-lib";

// Usage (from apps/web, after `next build`):
//   bun scripts/js-budget.ts [--dir .next] [--budgets js-budgets.json] [--all]
// Prints gzip client JavaScript per budget group and exits 1 when a route is over its budget.
// `--all` lists every route with its size, to set or revise the budgets.

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const routes = measureRoutes(resolve(arg("--dir", ".next")));
if (process.argv.includes("--all")) {
  for (const r of routes)
    console.log(`${String(r.bytes).padStart(8)}  ${r.route}`);
}
const budgets: BudgetFile = JSON.parse(
  readFileSync(resolve(arg("--budgets", "js-budgets.json")), "utf8"),
);
const result = checkBudgets(routes, budgets);
console.log(formatReport(result));
process.exit(result.ok ? 0 : 1);
