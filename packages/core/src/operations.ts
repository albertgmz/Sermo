import { operations as admin } from "./modules/admin";
import { operations as appearance } from "./modules/appearance";
import { operations as auth } from "./modules/auth";
import { operations as awards } from "./modules/awards";
import { operations as bookmarks } from "./modules/bookmarks";
import { operations as consent } from "./modules/consent";
import { operations as conversations } from "./modules/conversations";
import { operations as creditRules } from "./modules/credit-events";
import { operations as credits } from "./modules/credits";
import { operations as email } from "./modules/email";
import { operations as feed } from "./modules/feed";
import { operations as forums } from "./modules/forums";
import { operations as images } from "./modules/images";
import { operations as jobs } from "./modules/jobs";
import { operations as members } from "./modules/members";
import { operations as moderation } from "./modules/moderation";
import { operations as navigation } from "./modules/navigation";
import { operations as notices } from "./modules/notices";
import { operations as notifications } from "./modules/notifications";
import { operations as pages } from "./modules/pages";
import { operations as permissions } from "./modules/permissions";
import { operations as profiles } from "./modules/profiles";
import { operations as promotions } from "./modules/promotions";
import { operations as push } from "./modules/push";
import { operations as reactions } from "./modules/reactions";
import { operations as search } from "./modules/search";
import { operations as security } from "./modules/security";
import { operations as seo } from "./modules/seo";
import { operations as settings } from "./modules/settings";
import { operations as shop } from "./modules/shop";
import { operations as social } from "./modules/social";
import { operations as spoilers } from "./modules/spoilers";
import { operations as storage } from "./modules/storage";
import type { AnyOperation } from "./operation";

/** Every implemented operation. Adapters (REST, MCP) and benchmarks consume this list. */
export const operations: readonly AnyOperation[] = [
  ...auth,
  ...permissions,
  ...forums,
  ...feed,
  ...profiles,
  ...members,
  ...promotions,
  ...push,
  ...conversations,
  ...email,
  ...reactions,
  ...search,
  ...security,
  ...consent,
  ...bookmarks,
  ...jobs,
  ...settings,
  ...storage,
  ...images,
  ...moderation,
  ...notifications,
  ...notices,
  ...seo,
  ...social,
  ...credits,
  ...creditRules,
  ...awards,
  ...shop,
  ...appearance,
  ...navigation,
  ...pages,
  ...spoilers,
  ...admin,
];

export const operationsByName: ReadonlyMap<string, AnyOperation> = new Map(
  operations.map((op) => [op.name, op]),
);

export function getOperation(name: string): AnyOperation {
  const op = operationsByName.get(name);
  if (!op) throw new Error(`Unknown operation: ${name}`);
  return op;
}
