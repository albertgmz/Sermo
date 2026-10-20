import { expect } from "bun:test";
import { type Contract, type Ctx, contracts as c, closeContext, ensureAdmin } from "@sermo/core";
import { createTestContext } from "@sermo/core/testing";
import type * as z from "zod";
import {
  insertCatalogImage,
  insertPaletteColor,
} from "../../core/src/modules/appearance/catalog-fixtures";
import { createApp } from "./app";

const contexts: Ctx[] = [];
let nextIp = 1;
const origin = "http://localhost:3000";
export const missingId = 999999;
export type Auth = Record<string, string>;
export type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export function cleanupEconomy() {
  for (const ctx of contexts.splice(0)) closeContext(ctx);
}

function sessionCookies(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
}

export async function success<O extends z.ZodType>(
  pending: Promise<Response> | Response,
  output: O,
  status = 200,
): Promise<z.output<O>> {
  const response = await pending;
  const body: unknown = await response.json();
  expect(response.status, JSON.stringify(body)).toBe(status);
  expect(response.headers.get("content-type")).toContain("application/json");
  const parsed = output.parse(body);
  expect(body).toEqual(parsed);
  return parsed;
}

export async function error(
  pending: Promise<Response> | Response,
  status: number,
  code: string,
  issuePath?: (string | number)[],
) {
  const response = await pending;
  const body = (await response.json()) as {
    error: {
      code: string;
      message: string;
      issues?: { path: (string | number)[]; message: string }[];
    };
  };
  expect(response.status, JSON.stringify(body)).toBe(status);
  expect(response.headers.get("content-type")).toContain("application/json");
  expect(body).toEqual({
    error: {
      code,
      message: expect.any(String),
      ...(body.error.issues ? { issues: body.error.issues } : {}),
    },
  });
  expect(body.error.message.length).toBeGreaterThan(0);
  if (issuePath) {
    expect(body.error.issues?.length).toBeGreaterThan(0);
    expect(body.error.issues).toContainEqual({ path: issuePath, message: expect.any(String) });
  }
  return body.error;
}

export async function setup(mode: "cookie" | "key" = "cookie") {
  const ctx = createTestContext();
  contexts.push(ctx);
  const app = createApp(ctx, { trustedProxyHeader: null });
  const ip = `10.20.${Math.floor(nextIp / 250)}.${(nextIp++ % 250) + 1}`;
  const env = { requestIP: () => ({ address: ip, family: "IPv4" as const, port: 1 }) };
  const request = (path: string, init: RequestInit = {}) => app.request(path, init, env);
  const send = (method: Method, path: string, auth: Auth = {}, body?: object) =>
    request(`/api/v1${path}`, {
      method,
      headers: { "content-type": "application/json", ...auth },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const authPost = (path: string, body: object, cookie?: string) =>
    request(`/api/auth${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin, ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body),
    });
  const credentials = async (response: Response) => {
    expect(response.status, await response.clone().text()).toBe(200);
    const cookie = sessionCookies(response);
    expect(cookie).toContain("sermo.session_token=");
    const data = (await response.json()) as { user: { id: string } };
    const cookieAuth = { cookie, origin };
    let auth: Auth = cookieAuth;
    if (mode === "key") {
      const created = await authPost(
        "/api-key/create",
        { name: "economy", password: "Password123!" },
        cookie,
      );
      expect(created.status, await created.clone().text()).toBe(200);
      const { key } = (await created.json()) as { key: string };
      auth = { authorization: `Bearer ${key}` };
    }
    return { id: Number(data.user.id), auth, cookieAuth };
  };
  await ensureAdmin(ctx, {
    username: "admin",
    email: "admin@example.test",
    password: "Password123!",
  });
  const admin = await credentials(
    await authPost("/sign-in/email", { email: "admin@example.test", password: "Password123!" }),
  );
  const register = async (username: string) =>
    credentials(
      await authPost("/sign-up/email", {
        name: username,
        username,
        email: `${username}@example.test`,
        password: "Password123!",
      }),
    );
  const member = await register("member");
  const other = await register("other");
  const api = <O extends z.ZodType>(
    contract: Contract<z.ZodType, O>,
    method: Method,
    path: string,
    auth: Auth,
    body?: object,
    status = 200,
  ) => success(send(method, path, auth, body), contract.output, status);
  const category = (body: object = {}) =>
    api(
      c.shopCategoriesCreate,
      "POST",
      "/shop/categories",
      admin.auth,
      { name: "Catalog", ...body },
      201,
    );
  const award = (body: object = {}) =>
    api(
      c.awardsCreate,
      "POST",
      "/awards",
      admin.auth,
      { name: "Helpful", tier: "silver", ...body },
      201,
    );
  const frameId = insertCatalogImage(ctx, "frame");
  const nameColorId = insertPaletteColor(ctx);
  // A unit of a consumable permission can be used without a thread; a frame is only worn.
  const item = (
    categoryId: number,
    body: { isConsumable?: boolean; [key: string]: unknown } = {},
  ) =>
    api(
      c.shopItemsCreate,
      "POST",
      "/shop/items",
      admin.auth,
      {
        categoryId,
        name: "Frame",
        price: 10,
        effect: body.isConsumable
          ? { type: "permission", permission: "profile.signature" }
          : { type: "frame", frameId },
        ...body,
      },
      201,
    );
  const fund = (userId = member.id, amount = 100) =>
    api(
      c.creditsAdjust,
      "POST",
      `/users/${userId}/credits`,
      admin.auth,
      { amount, reason: "Opening credits" },
      201,
    );
  return {
    ctx,
    request,
    send,
    api,
    admin,
    member,
    other,
    category,
    award,
    item,
    fund,
    frameId,
    nameColorId,
  };
}

export async function fixture(mode: "cookie" | "key" = "cookie") {
  const f = await setup(mode);
  const rule = await f.api(
    c.creditRulesCreate,
    "POST",
    "/credit-rules",
    f.admin.auth,
    { title: "Replies", trigger: "reply_posted", amount: 2 },
    201,
  );
  const awardCategory = await f.api(
    c.awardCategoriesCreate,
    "POST",
    "/awards/categories",
    f.admin.auth,
    { title: "Helping" },
    201,
  );
  const emptyAwardCategory = await f.api(
    c.awardCategoriesCreate,
    "POST",
    "/awards/categories",
    f.admin.auth,
    { title: "Unused" },
    201,
  );
  const award = await f.award({ xp: 7, isStackable: true, categoryId: awardCategory.id });
  const ungrantedAward = await f.award({ name: "Ungrantable until selected" });
  const category = await f.category();
  const emptyCategory = await f.category({ name: "Empty" });
  const item = await f.item(category.id, { isConsumable: true, isGiftable: true, stock: 5 });
  // A rank, so that shop.upgrade has something to move up to.
  const rankGroup = f.ctx.sqlite
    .prepare<{ id: number }, []>(
      "INSERT INTO groups (title, rank) VALUES ('Supporters', 10) RETURNING id",
    )
    .get()!.id;
  const unboughtItem = await f.item(category.id, {
    name: "Unbought",
    effect: { type: "group", groupId: rankGroup },
  });
  await f.fund();
  const grant = await f.api(
    c.awardsGrant,
    "POST",
    `/users/${f.member.id}/awards`,
    f.admin.auth,
    { awardId: award.id, reason: "Helpful reply" },
    201,
  );
  const bought = await f.api(
    c.shopBuy,
    "POST",
    `/shop/items/${item.id}/buy`,
    f.member.auth,
    {},
    201,
  );
  expect(bought.inventory).not.toBeNull();
  return {
    ...f,
    rule,
    award,
    ungrantedAward,
    awardCategory,
    emptyAwardCategory,
    category,
    emptyCategory,
    item,
    unboughtItem,
    grant,
    bought,
    inventory: bought.inventory!,
  };
}
export type Fixture = Awaited<ReturnType<typeof fixture>>;

export function deny(ctx: Ctx, userId: number, permission: string) {
  ctx.sqlite
    .prepare(
      "INSERT INTO permission_entries (user_id, permission_id, value) SELECT ?1, id, -1 FROM permission_definitions WHERE key = ?2",
    )
    .run(userId, permission);
}
