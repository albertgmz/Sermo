import { afterEach, expect, test } from "bun:test";
import type { Ctx } from "@sermo/core";
import { closeContext } from "@sermo/core";
import { createTestContext, insertUser } from "@sermo/core/testing";
import { createApp } from "./app";

const contexts: Ctx[] = [];
let nextIp = 1;
afterEach(() => {
  for (const ctx of contexts.splice(0)) closeContext(ctx);
});

function setup() {
  const ctx = createTestContext();
  contexts.push(ctx);
  const app = createApp(ctx, { trustedProxyHeader: null });
  const env = {
    requestIP: () => ({ address: `10.3.0.${nextIp++}`, family: "IPv4" as const, port: 1 }),
  };
  const get = (path: string) => app.request(path, {}, env);
  return { ctx, get, app, env };
}

for (const route of ["member-cards", "member-authors", "member-relations"] as const)
  test(`/${route} takes repeated userIds as an array of numbers, also for one value`, async () => {
    const { ctx, get } = setup();
    const users = Array.from({ length: 3 }, () => insertUser(ctx));
    const one = await get(`/api/v1/${route}?userIds=${users[0]!.id}`);
    expect(one.status).toBe(200);
    expect(((await one.json()) as { items: unknown[] }).items).toHaveLength(1);
    const many = await get(
      `/api/v1/${route}?${users.map((user) => `userIds=${user.id}`).join("&")}`,
    );
    expect(many.status).toBe(200);
    expect(((await many.json()) as { items: unknown[] }).items).toHaveLength(3);
  });

test("/member-cards takes up to 100 ids and refuses 101", async () => {
  const { ctx, get } = setup();
  const ids = Array.from({ length: 101 }, () => insertUser(ctx).id);
  const query = (list: number[]) => list.map((id) => `userIds=${id}`).join("&");
  const hundred = await get(`/api/v1/member-cards?${query(ids.slice(0, 100))}`);
  expect(hundred.status).toBe(200);
  expect(((await hundred.json()) as { items: unknown[] }).items).toHaveLength(100);
  expect((await get(`/api/v1/member-cards?${query(ids)}`)).status).toBe(400);
  expect((await get("/api/v1/member-cards")).status).toBe(400);
});

test("/member-authors takes up to 50 ids", async () => {
  const { ctx, get } = setup();
  const ids = Array.from({ length: 51 }, () => insertUser(ctx).id);
  const query = (list: number[]) => list.map((id) => `userIds=${id}`).join("&");
  expect((await get(`/api/v1/member-authors?${query(ids.slice(0, 50))}`)).status).toBe(200);
  expect((await get(`/api/v1/member-authors?${query(ids)}`)).status).toBe(400);
});

test("the directory and standing routes answer to guests", async () => {
  const { ctx, get } = setup();
  insertUser(ctx);
  for (const path of [
    "/api/v1/members",
    "/api/v1/members?sort=posts&limit=5",
    "/api/v1/members/staff",
    "/api/v1/members/birthdays",
    "/api/v1/standings",
    "/api/v1/standings?month=previous",
    "/api/v1/standings/winners",
  ]) {
    const response = await get(path);
    expect(response.status, path).toBe(200);
  }
  const staff = (await (await get("/api/v1/members/staff")).json()) as { items: unknown[] };
  expect(Array.isArray(staff.items)).toBe(true);
});

test("/members?ranked=true leaves out the members who scored nothing, ranked=false lists them", async () => {
  const { ctx, get } = setup();
  const scorer = insertUser(ctx);
  insertUser(ctx);
  ctx.sqlite.prepare("UPDATE users SET credits = 7 WHERE id = ?1").run(scorer.id);
  const ids = async (query: string) =>
    (
      (await (await get(`/api/v1/members?sort=credits&${query}`)).json()) as {
        items: { card: { id: number } }[];
      }
    ).items.map((item) => item.card.id);
  expect(await ids("ranked=true")).toEqual([scorer.id]);
  expect((await ids("ranked=false")).length).toBeGreaterThan(1);
});

test("the account routes need a signed-in member", async () => {
  const { get } = setup();
  expect((await get("/api/v1/profile")).status).toBe(401);
});

test("/member-relations takes up to 50 ids, answers a guest with false flags and refuses 51", async () => {
  const { ctx, get } = setup();
  const ids = Array.from({ length: 51 }, () => insertUser(ctx).id);
  const query = (list: number[]) => list.map((id) => `userIds=${id}`).join("&");
  const fifty = await get(`/api/v1/member-relations?${query(ids.slice(0, 50))}`);
  expect(fifty.status).toBe(200);
  const body = (await fifty.json()) as { items: Record<string, unknown>[] };
  expect(body.items).toHaveLength(50);
  expect(body.items[0]).toMatchObject({ following: false, canFollow: false, canMessage: false });
  expect((await get(`/api/v1/member-relations?${query(ids)}`)).status).toBe(400);
});
