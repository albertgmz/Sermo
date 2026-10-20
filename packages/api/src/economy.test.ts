import { afterEach, describe, expect, test } from "bun:test";
import { type Contract, contracts as c, getOperation } from "@sermo/core";
import { toolInputSchema } from "@sermo/mcp";
import {
  cleanupEconomy,
  deny,
  error,
  type Fixture,
  fixture,
  type Method,
  missingId,
  setup,
  success,
} from "./economy-fixtures.test";
import { routes } from "./routes";

afterEach(cleanupEconomy);
interface RouteCase {
  contract: Contract;
  method: Method;
  path: string;
  status: 200 | 201;
  url: (f: Fixture) => string;
  body?: (f: Fixture) => object;
  as?: "member";
  guest?: "public";
  denied?: { permission?: string; status?: 403 | 404; url?: (f: Fixture) => string };
  invalid?: { url?: (f: Fixture) => string; body?: object; issue: string };
  missing?: { url?: (f: Fixture) => string; body?: (f: Fixture) => object };
  expected: (f: Fixture) => object;
}

// This independent route inventory makes omissions and accidental method/status changes visible.
const cases: RouteCase[] = [
  {
    contract: c.creditsHistory,
    method: "GET",
    path: "/credits",
    status: 200,
    url: () => "/credits?limit=1",
    as: "member",
    invalid: { url: () => "/credits?limit=0", issue: "limit" },
    expected: (f) => ({
      balance: 90,
      items: [{ userId: f.member.id, amount: -10, type: "purchase" }],
      nextCursor: expect.any(String),
    }),
  },
  {
    contract: c.creditsLedger,
    method: "GET",
    path: "/credits/ledger",
    status: 200,
    url: (f) => `/credits/ledger?userId=${f.member.id}&limit=1`,
    denied: {},
    invalid: { url: () => "/credits/ledger?userId=1e0", issue: "userId" },
    missing: { url: () => `/credits/ledger?userId=${missingId}` },
    expected: (f) => ({
      balance: 90,
      items: [{ userId: f.member.id, amount: -10 }],
      nextCursor: expect.any(String),
    }),
  },
  {
    contract: c.creditsWays,
    method: "GET",
    path: "/credits/ways",
    status: 200,
    url: () => "/credits/ways",
    guest: "public",
    expected: () => ({
      items: [{ title: "Replies", trigger: "reply_posted", amount: 2, limit: null, forums: [] }],
    }),
  },
  {
    contract: c.creditsAdjust,
    method: "POST",
    path: "/users/{userId}/credits",
    status: 201,
    url: (f) => `/users/${f.member.id}/credits`,
    body: () => ({ amount: 12, reason: "  Bonus  " }),
    denied: {},
    invalid: { body: { amount: 0, reason: "No zero adjustment" }, issue: "amount" },
    missing: { url: () => `/users/${missingId}/credits` },
    expected: (f) => ({
      userId: f.member.id,
      amount: 12,
      balanceAfter: 102,
      reason: "Bonus",
      actor: { id: f.admin.id },
      type: "adjustment",
      source: null,
    }),
  },
  {
    contract: c.creditsRecalculate,
    method: "POST",
    path: "/credits/recalculate",
    status: 201,
    url: () => "/credits/recalculate",
    body: () => ({}),
    denied: {},
    expected: () => ({ queued: true }),
  },
  {
    contract: c.creditRulesList,
    method: "GET",
    path: "/credit-rules",
    status: 200,
    url: () => "/credit-rules",
    denied: {},
    expected: (f) => ({ items: [f.rule] }),
  },
  {
    contract: c.creditRulesCreate,
    method: "POST",
    path: "/credit-rules",
    status: 201,
    url: () => "/credit-rules",
    body: () => ({
      title: "  Threads  ",
      trigger: "thread_created",
      amount: 5,
      limit: { count: 2, windowHours: 24 },
    }),
    denied: {},
    invalid: { body: { title: "Invalid", trigger: "missing", amount: 1 }, issue: "trigger" },
    expected: () => ({
      title: "Threads",
      trigger: "thread_created",
      amount: 5,
      isActive: true,
      limit: { count: 2, windowHours: 24 },
      nodeIds: [],
    }),
  },
  {
    contract: c.creditRulesUpdate,
    method: "PATCH",
    path: "/credit-rules/{ruleId}",
    status: 200,
    url: (f) => `/credit-rules/${f.rule.id}`,
    body: () => ({ title: "Changed", amount: -2, isActive: false }),
    denied: {},
    invalid: { body: { amount: 0 }, issue: "amount" },
    missing: { url: () => `/credit-rules/${missingId}` },
    expected: (f) => ({
      id: f.rule.id,
      title: "Changed",
      amount: -2,
      isActive: false,
      trigger: "reply_posted",
    }),
  },
  {
    contract: c.creditRulesDelete,
    method: "DELETE",
    path: "/credit-rules/{ruleId}",
    status: 200,
    url: (f) => `/credit-rules/${f.rule.id}`,
    denied: {},
    invalid: { url: () => "/credit-rules/nope", issue: "ruleId" },
    missing: { url: () => `/credit-rules/${missingId}` },
    expected: () => ({ ok: true }),
  },
  {
    contract: c.awardsCriteria,
    method: "GET",
    path: "/awards/criteria",
    status: 200,
    url: () => "/awards/criteria",
    denied: {},
    expected: () => ({
      items: expect.arrayContaining([expect.objectContaining({ id: "credits_at_least" })]),
    }),
  },
  {
    contract: c.awardsRun,
    method: "POST",
    path: "/awards/run",
    status: 201,
    url: () => "/awards/run",
    body: () => ({}),
    denied: {},
    expected: () => ({ queued: true }),
  },
  {
    contract: c.awardsList,
    method: "GET",
    path: "/awards",
    status: 200,
    url: () => "/awards",
    guest: "public",
    denied: { permission: "profile.view" },
    expected: (f) => ({ items: [{ id: f.award.id, grantCount: 1 }, f.ungrantedAward] }),
  },
  {
    contract: c.awardCategoriesList,
    method: "GET",
    path: "/awards/categories",
    status: 200,
    url: () => "/awards/categories",
    guest: "public",
    denied: { permission: "profile.view" },
    expected: (f) => ({
      items: [
        { ...f.awardCategory, awardCount: 1 },
        { ...f.emptyAwardCategory, awardCount: 0 },
      ],
    }),
  },
  {
    contract: c.awardCategoriesCreate,
    method: "POST",
    path: "/awards/categories",
    status: 201,
    url: () => "/awards/categories",
    body: () => ({ title: "  By posts  ", position: 4 }),
    denied: {},
    invalid: { body: { title: "" }, issue: "title" },
    expected: () => ({ title: "By posts", position: 4, description: "", awardCount: 0 }),
  },
  {
    contract: c.awardCategoriesUpdate,
    method: "PATCH",
    path: "/awards/categories/{categoryId}",
    status: 200,
    url: (f) => `/awards/categories/${f.awardCategory.id}`,
    body: () => ({ title: "Renamed", position: 9 }),
    denied: {},
    invalid: { body: { position: -1 }, issue: "position" },
    missing: { url: () => `/awards/categories/${missingId}` },
    expected: (f) => ({ id: f.awardCategory.id, title: "Renamed", position: 9, awardCount: 1 }),
  },
  {
    contract: c.awardCategoriesDelete,
    method: "DELETE",
    path: "/awards/categories/{categoryId}",
    status: 200,
    url: (f) => `/awards/categories/${f.awardCategory.id}`,
    denied: {},
    invalid: { url: () => "/awards/categories/nope", issue: "categoryId" },
    missing: { url: () => `/awards/categories/${missingId}` },
    expected: () => ({ ok: true }),
  },
  {
    contract: c.awardsGet,
    method: "GET",
    path: "/awards/{awardId}",
    status: 200,
    url: (f) => `/awards/${f.award.id}`,
    guest: "public",
    denied: { permission: "profile.view" },
    invalid: { url: () => "/awards/1.0", issue: "awardId" },
    missing: { url: () => `/awards/${missingId}` },
    expected: (f) => ({ ...f.award, grantCount: 1 }),
  },
  {
    contract: c.awardsCreate,
    method: "POST",
    path: "/awards",
    status: 201,
    url: () => "/awards",
    body: () => ({ name: "  Gold award  ", tier: "gold", xp: 20, credits: 5 }),
    denied: {},
    invalid: { body: { name: "Invalid", tier: "platinum" }, issue: "tier" },
    expected: () => ({
      name: "Gold award",
      tier: "gold",
      xp: 20,
      credits: 5,
      isActive: true,
      isStackable: false,
      rule: { match: "all", conditions: [] },
      grantCount: 0,
    }),
  },
  {
    contract: c.awardsUpdate,
    method: "PATCH",
    path: "/awards/{awardId}",
    status: 200,
    url: (f) => `/awards/${f.award.id}`,
    body: () => ({ name: "Renamed", tier: "legendary", credits: 20 }),
    denied: {},
    invalid: { body: { xp: -1 }, issue: "xp" },
    missing: { url: () => `/awards/${missingId}` },
    expected: (f) => ({
      id: f.award.id,
      name: "Renamed",
      tier: "legendary",
      credits: 20,
      grantCount: 1,
    }),
  },
  {
    contract: c.awardsDelete,
    method: "DELETE",
    path: "/awards/{awardId}",
    status: 200,
    url: (f) => `/awards/${f.ungrantedAward.id}`,
    denied: {},
    invalid: { url: () => "/awards/-1", issue: "awardId" },
    missing: { url: () => `/awards/${missingId}` },
    expected: () => ({ ok: true }),
  },
  {
    contract: c.awardsHolders,
    method: "GET",
    path: "/awards/{awardId}/holders",
    status: 200,
    url: (f) => `/awards/${f.award.id}/holders?limit=1`,
    guest: "public",
    denied: { permission: "profile.view" },
    invalid: { url: (f) => `/awards/${f.award.id}/holders?limit=101`, issue: "limit" },
    missing: { url: () => `/awards/${missingId}/holders` },
    expected: (f) => ({ items: [f.grant], nextCursor: null }),
  },
  {
    contract: c.awardsMember,
    method: "GET",
    path: "/users/{userId}/awards",
    status: 200,
    url: (f) => `/users/${f.member.id}/awards`,
    guest: "public",
    denied: { permission: "profile.view", status: 404 },
    invalid: { url: () => "/users/nope/awards", issue: "userId" },
    missing: { url: () => `/users/${missingId}/awards` },
    expected: (f) => ({ xp: 7, items: [{ award: { id: f.award.id }, count: 1 }] }),
  },
  {
    contract: c.awardsGrant,
    method: "POST",
    path: "/users/{userId}/awards",
    status: 201,
    url: (f) => `/users/${f.member.id}/awards`,
    body: (f) => ({ awardId: f.award.id, reason: "  Again  " }),
    denied: {},
    invalid: { body: { awardId: "1" }, issue: "awardId" },
    missing: { body: () => ({ awardId: missingId }) },
    expected: (f) => ({
      user: { id: f.member.id },
      award: { id: f.award.id, grantCount: 2 },
      grantedBy: { id: f.admin.id },
      reason: "Again",
    }),
  },
  {
    contract: c.awardsMemberGrants,
    method: "GET",
    path: "/users/{userId}/award-grants",
    status: 200,
    url: (f) => `/users/${f.member.id}/award-grants?limit=1`,
    guest: "public",
    denied: { permission: "profile.view", status: 404 },
    invalid: { url: (f) => `/users/${f.member.id}/award-grants?limit=nope`, issue: "limit" },
    missing: { url: () => `/users/${missingId}/award-grants` },
    expected: (f) => ({ items: [f.grant], nextCursor: null }),
  },
  {
    contract: c.awardsRevoke,
    method: "DELETE",
    path: "/award-grants/{memberAwardId}",
    status: 200,
    url: (f) => `/award-grants/${f.grant.id}?reason=Reversed%20grant`,
    denied: {},
    invalid: { url: () => "/award-grants/0", issue: "memberAwardId" },
    missing: { url: () => `/award-grants/${missingId}` },
    expected: () => ({ ok: true }),
  },
  {
    contract: c.shopCategoriesList,
    method: "GET",
    path: "/shop/categories",
    status: 200,
    url: () => "/shop/categories",
    guest: "public",
    expected: (f) => ({ items: [f.category, f.emptyCategory] }),
  },
  {
    contract: c.shopCategoriesCreate,
    method: "POST",
    path: "/shop/categories",
    status: 201,
    url: () => "/shop/categories",
    body: () => ({ name: "  New catalog  ", position: 3 }),
    denied: {},
    invalid: { body: { name: "" }, issue: "name" },
    expected: () => ({ name: "New catalog", position: 3, isActive: true, description: "" }),
  },
  {
    contract: c.shopCategoriesUpdate,
    method: "PATCH",
    path: "/shop/categories/{categoryId}",
    status: 200,
    url: (f) => `/shop/categories/${f.category.id}`,
    body: () => ({ name: "Changed", isActive: false }),
    denied: {},
    invalid: { body: { position: -1 }, issue: "position" },
    missing: { url: () => `/shop/categories/${missingId}` },
    expected: (f) => ({ id: f.category.id, name: "Changed", isActive: false }),
  },
  {
    contract: c.shopCategoriesDelete,
    method: "DELETE",
    path: "/shop/categories/{categoryId}",
    status: 200,
    url: (f) => `/shop/categories/${f.emptyCategory.id}`,
    denied: {},
    invalid: { url: () => "/shop/categories/nope", issue: "categoryId" },
    missing: { url: () => `/shop/categories/${missingId}` },
    expected: () => ({ ok: true }),
  },
  {
    contract: c.shopItemsList,
    method: "GET",
    path: "/shop/categories/{categoryId}/items",
    status: 200,
    url: (f) => `/shop/categories/${f.category.id}/items?limit=1`,
    guest: "public",
    invalid: { url: (f) => `/shop/categories/${f.category.id}/items?limit=0`, issue: "limit" },
    expected: (f) => ({ items: [{ id: f.item.id, stock: 4 }], nextCursor: expect.any(String) }),
  },
  {
    contract: c.shopItemsGet,
    method: "GET",
    path: "/shop/items/{itemId}",
    status: 200,
    url: (f) => `/shop/items/${f.item.id}`,
    guest: "public",
    invalid: { url: () => "/shop/items/1e0", issue: "itemId" },
    missing: { url: () => `/shop/items/${missingId}` },
    expected: (f) => ({ ...f.item, stock: 4 }),
  },
  {
    contract: c.shopItemsCreate,
    method: "POST",
    path: "/shop/items",
    status: 201,
    url: () => "/shop/items",
    body: (f) => ({
      categoryId: f.category.id,
      name: "New item",
      price: 4,
      effect: { type: "nameColor", colorId: f.nameColorId },
    }),
    denied: {},
    invalid: {
      body: { categoryId: 1, name: "Invalid", price: -1, effect: { type: "bump" } },
      issue: "price",
    },
    missing: {
      body: () => ({
        categoryId: missingId,
        name: "Missing category",
        price: 1,
        effect: { type: "bump" },
      }),
    },
    expected: (f) => ({
      categoryId: f.category.id,
      name: "New item",
      price: 4,
      effect: { type: "nameColor", colorId: f.nameColorId },
      stock: null,
      isActive: true,
    }),
  },
  {
    contract: c.shopItemsUpdate,
    method: "PATCH",
    path: "/shop/items/{itemId}",
    status: 200,
    url: (f) => `/shop/items/${f.item.id}`,
    body: () => ({ name: "Changed", price: 15, stock: 9 }),
    denied: {},
    invalid: { body: { stock: -1 }, issue: "stock" },
    missing: { url: () => `/shop/items/${missingId}` },
    expected: (f) => ({ id: f.item.id, name: "Changed", price: 15, stock: 9 }),
  },
  {
    contract: c.shopItemsDelete,
    method: "DELETE",
    path: "/shop/items/{itemId}",
    status: 200,
    url: (f) => `/shop/items/${f.unboughtItem.id}`,
    denied: {},
    invalid: { url: () => "/shop/items/0", issue: "itemId" },
    missing: { url: () => `/shop/items/${missingId}` },
    expected: () => ({ ok: true }),
  },
  {
    contract: c.shopBuy,
    method: "POST",
    path: "/shop/items/{itemId}/buy",
    status: 201,
    url: (f) => `/shop/items/${f.item.id}/buy`,
    body: () => ({ quantity: 2 }),
    as: "member",
    denied: { permission: "shop.buy" },
    invalid: { body: { quantity: 0 }, issue: "quantity" },
    missing: { url: () => `/shop/items/${missingId}/buy` },
    expected: (f) => ({
      balance: 70,
      inventory: { userId: f.member.id, quantity: 3, state: "unused" },
      purchase: {
        item: { id: f.item.id },
        buyer: { id: f.member.id },
        recipient: { id: f.member.id },
        quantity: 2,
        price: 20,
      },
    }),
  },
  {
    contract: c.shopInventory,
    method: "GET",
    path: "/shop/inventory",
    status: 200,
    url: () => "/shop/inventory?state=unused&limit=1",
    as: "member",
    denied: { url: (f) => `/shop/inventory?state=unused&userId=${f.other.id}` },
    invalid: { url: () => "/shop/inventory?state=missing", issue: "state" },
    missing: { url: () => `/shop/inventory?state=unused&userId=${missingId}` },
    expected: (f) => ({ items: [f.inventory], nextCursor: null }),
  },
  {
    contract: c.shopUpgrade,
    method: "POST",
    path: "/shop/items/{itemId}/upgrade",
    status: 201,
    url: (f) => `/shop/items/${f.unboughtItem.id}/upgrade`,
    body: () => ({}),
    as: "member",
    denied: { permission: "shop.buy" },
    invalid: { url: () => "/shop/items/1e0/upgrade", issue: "itemId" },
    missing: { url: () => `/shop/items/${missingId}/upgrade` },
    expected: (f) => ({
      replacedItemId: null,
      balance: 80,
      purchase: { price: 10, item: { id: f.unboughtItem.id } },
      inventory: { state: "active", userId: f.member.id },
    }),
  },
  {
    contract: c.shopUse,
    method: "POST",
    path: "/shop/inventory/{inventoryId}/use",
    status: 200,
    url: (f) => `/shop/inventory/${f.inventory.id}/use`,
    body: () => ({}),
    as: "member",
    denied: { permission: "shop.buy" },
    invalid: { body: { threadId: 0 }, issue: "threadId" },
    missing: { url: () => `/shop/inventory/${missingId}/use` },
    expected: (f) => ({ id: f.inventory.id, userId: f.member.id, quantity: 0, state: "used" }),
  },
  {
    contract: c.shopPurchases,
    method: "GET",
    path: "/shop/purchases",
    status: 200,
    url: (f) => `/shop/purchases?buyerId=${f.member.id}&itemId=${f.item.id}&limit=1`,
    denied: {},
    invalid: { url: () => "/shop/purchases?buyerId=nope", issue: "buyerId" },
    expected: (f) => ({ items: [f.bought.purchase], nextCursor: null }),
  },
];

test("economy has exactly the 39 documented route mappings", () => {
  expect(cases).toHaveLength(39);
  expect(new Set(cases.map(({ contract }) => contract.name)).size).toBe(39);
  const actual = routes.filter(({ operation }) =>
    /^(credits|creditRules|awards|awardCategories|shopCategories|shopItems|shop)\./.test(operation),
  );
  expect(actual).toHaveLength(39);
  for (const row of cases)
    expect(actual.find(({ operation }) => operation === row.contract.name)).toMatchObject({
      method: row.method,
      path: row.path,
      status: row.status,
    });
});

for (const mode of ["cookie", "key"] as const) {
  describe(`economy HTTP with ${mode} authentication`, () => {
    for (const row of cases) {
      test(`${row.contract.name}: ${row.method} ${row.path} returns ${row.status} and its contract`, async () => {
        const f = await fixture(mode);
        const body = await success(
          f.send(row.method, row.url(f), f[row.as ?? "admin"].auth, row.body?.(f)),
          row.contract.output,
          row.status,
        );
        expect(body).toMatchObject(row.expected(f));
      });
      test(`${row.contract.name}: authentication, permissions and input errors`, async () => {
        const f = await fixture(mode);
        const url = row.url(f);
        const body = row.body?.(f);
        if (row.guest === "public") {
          const result = await success(f.send(row.method, url), row.contract.output, row.status);
          expect(result).toMatchObject(row.expected(f));
        } else {
          await error(f.send(row.method, url, {}, body), 401, "unauthenticated");
        }
        await error(
          f.send(row.method, url, { authorization: "Bearer invalid-economy-key" }, body),
          401,
          "unauthenticated",
        );
        for (const [index, segment] of row.path.split("/").entries()) {
          if (!segment.startsWith("{")) continue;
          const parts = url.split("?")[0]!.split("/");
          parts[index] = "not-an-id";
          await error(f.send(row.method, parts.join("/"), f.admin.auth, body), 400, "validation", [
            segment.slice(1, -1),
          ]);
        }
        if (row.invalid)
          await error(
            f.send(row.method, row.invalid.url?.(f) ?? url, f.admin.auth, row.invalid.body ?? body),
            400,
            "validation",
            [row.invalid.issue],
          );
        if (row.missing)
          await error(
            f.send(
              row.method,
              row.missing.url?.(f) ?? url,
              row.contract === c.shopUse || row.contract === c.shopUpgrade
                ? f.member.auth
                : f.admin.auth,
              row.missing.body?.(f) ?? body,
            ),
            404,
            "not_found",
          );
        if (mode === "cookie" && row.method !== "GET") {
          const init = { method: row.method, body: JSON.stringify(body ?? {}) };
          await error(
            f.request(`/api/v1${url}`, {
              ...init,
              headers: {
                ...f.admin.cookieAuth,
                "content-type": "text/plain",
                origin: "https://other.example",
              },
            }),
            403,
            "forbidden",
          );
          await error(
            f.request(`/api/v1${url}`, { ...init, headers: f.admin.cookieAuth }),
            415,
            "unsupported_media_type",
          );
        }
        if (row.denied) {
          if (row.denied.permission) deny(f.ctx, f.member.id, row.denied.permission);
          const status = row.denied.status ?? 403;
          await error(
            f.send(row.method, row.denied.url?.(f) ?? url, f.member.auth, body),
            status,
            status === 404 ? "not_found" : "forbidden",
          );
        }
      });
    }
  });
}

test("OpenAPI over HTTP documents all 35 economy operations and references shared schemas", async () => {
  const f = await setup();
  const response = await f.request("/api/v1/openapi.json");
  expect(response.status).toBe(200);
  type Endpoint = {
    operationId: string;
    parameters: {
      name: string;
      in: string;
      required: boolean;
      schema: { type?: string; enum?: string[] };
    }[];
    responses: Record<string, unknown>;
  };
  const doc = (await response.json()) as {
    paths: Record<string, Record<string, Endpoint>>;
    components: { schemas: Record<string, unknown> };
  };
  const referenced = new Set<string>();
  const visit = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (key === "$ref" && typeof child === "string") {
        expect(child).toStartWith("#/components/schemas/");
        const name = child.slice("#/components/schemas/".length);
        expect(doc.components.schemas[name], name).toBeDefined();
        if (!referenced.has(name)) {
          referenced.add(name);
          visit(doc.components.schemas[name]);
        }
      } else visit(child);
    }
  };
  const expectedNames = cases.map(({ contract }) => contract.name).sort();
  const actualNames = Object.values(doc.paths)
    .flatMap((methods) => Object.values(methods).map(({ operationId }) => operationId))
    .filter((name) =>
      /^(credits|creditRules|awards|awardCategories|shopCategories|shopItems|shop)\./.test(name),
    )
    .sort();
  expect(actualNames).toEqual(expectedNames);
  for (const row of cases) {
    const endpoint = doc.paths[`/api/v1${row.path}`]![row.method.toLowerCase()]!;
    expect(endpoint.operationId).toBe(row.contract.name);
    expect(endpoint.responses[String(row.status)]).toBeDefined();
    for (const match of row.path.matchAll(/\{([^}]+)\}/g)) {
      expect(endpoint.parameters).toContainEqual(
        expect.objectContaining({
          name: match[1],
          in: "path",
          required: true,
          schema: expect.objectContaining({ type: "integer" }),
        }),
      );
    }
    visit(endpoint);
  }
  for (const name of [
    "CreditTransaction",
    "CreditRule",
    "Award",
    "MemberAward",
    "ShopItem",
    "ShopEffect",
    "ShopInventoryEntry",
    "ShopPurchase",
  ]) {
    expect(doc.components.schemas[name], name).toBeDefined();
    expect(referenced.has(name), `shared schema ${name} is referenced`).toBe(true);
  }
  const inventory = doc.paths["/api/v1/shop/inventory"]!.get!;
  expect(inventory.parameters).toContainEqual(
    expect.objectContaining({
      name: "state",
      in: "query",
      required: true,
      schema: expect.objectContaining({ enum: ["active", "unused", "used", "expired"] }),
    }),
  );
  for (const name of ["userId", "limit"])
    expect(inventory.parameters).toContainEqual(
      expect.objectContaining({
        name,
        in: "query",
        schema: expect.objectContaining({ type: "integer" }),
      }),
    );
  expect(inventory.parameters).toContainEqual(
    expect.objectContaining({
      name: "cursor",
      in: "query",
      schema: expect.objectContaining({ type: "string" }),
    }),
  );
});

test("MCP tools/list over HTTP exposes exactly one tool for each economy contract", async () => {
  const f = await setup("key");
  const response = await f.request("/mcp", {
    method: "POST",
    headers: {
      ...f.admin.auth,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  expect(response.status).toBe(200);
  const body = (await response.json()) as {
    jsonrpc: string;
    id: number;
    result: {
      tools: {
        name: string;
        description: string;
        inputSchema: unknown;
        outputSchema: { type: string };
        annotations: { readOnlyHint: boolean };
      }[];
    };
  };
  expect(body).toMatchObject({ jsonrpc: "2.0", id: 1 });
  const economy = body.result.tools.filter(({ name }) =>
    /^(credits|creditRules|awards|awardCategories|shopCategories|shopItems|shop)_/.test(name),
  );
  expect(economy.map(({ name }) => name).sort()).toEqual(
    cases.map(({ contract }) => contract.name.replaceAll(".", "_")).sort(),
  );
  for (const { contract } of cases) {
    const tool = economy.find(({ name }) => name === contract.name.replaceAll(".", "_"))!;
    expect(tool.description).toBe(contract.summary);
    expect(tool.inputSchema).toEqual(toolInputSchema(getOperation(contract.name)));
    expect(tool.outputSchema.type).toBe("object");
    expect(tool.annotations.readOnlyHint).toBe(contract.kind === "read");
  }
});
