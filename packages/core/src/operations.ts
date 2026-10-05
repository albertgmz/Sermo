import { operations as auth } from "./modules/auth";
import { operations as conversations } from "./modules/conversations";
import { operations as forums } from "./modules/forums";
import { operations as images } from "./modules/images";
import { operations as jobs } from "./modules/jobs";
import { operations as permissions } from "./modules/permissions";
import { operations as profiles } from "./modules/profiles";
import { operations as reactions } from "./modules/reactions";
import { operations as search } from "./modules/search";
import { operations as settings } from "./modules/settings";
import { operations as storage } from "./modules/storage";
import type { AnyOperation } from "./operation";

/** Every implemented operation. Adapters (REST, MCP) and benchmarks consume this list. */
export const operations: readonly AnyOperation[] = [
  ...auth,
  ...permissions,
  ...forums,
  ...profiles,
  ...conversations,
  ...reactions,
  ...search,
  ...jobs,
  ...settings,
  ...storage,
  ...images,
];

export const operationsByName: ReadonlyMap<string, AnyOperation> = new Map(
  operations.map((op) => [op.name, op]),
);

export function getOperation(name: string): AnyOperation {
  const op = operationsByName.get(name);
  if (!op) throw new Error(`Unknown operation: ${name}`);
  return op;
}
