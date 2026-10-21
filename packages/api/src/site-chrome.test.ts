import { afterEach, expect, test } from "bun:test";
import type { Ctx } from "@sermo/core";
import { closeContext } from "@sermo/core";
import { createTestContext } from "@sermo/core/testing";
import { createApp } from "./app";

const contexts: Ctx[] = [];
let nextIp = 1;
afterEach(() => {
  for (const ctx of contexts.splice(0)) closeContext(ctx);
});

const origin = "http://localhost:3000";

async function setup() {
  const ctx = createTestContext();
  contexts.push(ctx);
  const app = createApp(ctx, { trustedProxyHeader: null });
  const env = {
    requestIP: () => ({ address: `10.3.0.${nextIp++}`, family: "IPv4" as const, port: 1 }),
  };
  const request = (path: string, init: RequestInit = {}) => app.request(path, init, env);
  const register = async (username: string) => {
    const response = await request("/api/auth/sign-up/email", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin,
        "x-forwarded-for": `198.51.100.${nextIp++}`,
      },
      body: JSON.stringify({
        name: username,
        username,
        email: `${username}@example.test`,
        password: "Password123!",
      }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { user: { id: string } };
    return {
      id: Number(body.user.id),
      cookie: response.headers
        .getSetCookie()
        .map((value) => value.split(";")[0])
        .join("; "),
    };
  };
  const admin = await register("chromeadmin");
  ctx.sqlite.prepare("UPDATE users SET group_id = 4 WHERE id = ?1").run(admin.id);
  const member = await register("chromemember");
  return { ctx, request, admin, member };
}

const json = (cookie: string | null, method: string, body?: object): RequestInit => ({
  method,
  headers: { origin, "content-type": "application/json", ...(cookie ? { cookie } : {}) },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

test("navigation is public, its administration is not, and PATCH null reaches the operation", async () => {
  const { request, admin, member } = await setup();
  const guest = await request("/api/v1/navigation");
  expect(guest.status).toBe(200);
  const view = (await guest.json()) as { header: { title: string }[]; footer: unknown[] };
  expect(view.header[0]?.title).toBe("Forums");

  expect((await request("/api/v1/navigation/entries")).status).toBe(401);
  expect((await request("/api/v1/navigation/entries", json(member.cookie, "GET"))).status).toBe(
    403,
  );

  const parent = (await (
    await request(
      "/api/v1/navigation/entries",
      json(admin.cookie, "POST", { location: "footer", title: "Group", target: null }),
    )
  ).json()) as { id: number };
  const created = await request(
    "/api/v1/navigation/entries",
    json(admin.cookie, "POST", {
      location: "footer",
      parentId: parent.id,
      title: "Child",
      target: "/rules",
    }),
  );
  expect(created.status).toBe(201);
  const child = (await created.json()) as { id: number; parentId: number; target: string };
  expect(child).toMatchObject({ parentId: parent.id, target: "/rules" });

  const patched = await request(
    `/api/v1/navigation/entries/${child.id}`,
    json(admin.cookie, "PATCH", { parentId: null, target: null }),
  );
  expect(patched.status).toBe(200);
  expect(await patched.json()).toMatchObject({ parentId: null, target: null });

  const removed = await request(
    `/api/v1/navigation/entries/${child.id}`,
    json(admin.cookie, "DELETE"),
  );
  expect(removed.status).toBe(200);
});

test("pages are read by slug, written with PUT and hidden while unpublished", async () => {
  const { request, admin, member } = await setup();
  const body = { title: "Terms", body: "Be [B]kind[/B].", isPublished: false };
  expect((await request("/api/v1/pages/terms", json(member.cookie, "PUT", body))).status).toBe(403);
  const saved = await request("/api/v1/pages/terms", json(admin.cookie, "PUT", body));
  expect(saved.status).toBe(200);
  expect((await request("/api/v1/pages/terms")).status).toBe(404);
  expect((await request("/api/v1/pages/terms", json(admin.cookie, "GET"))).status).toBe(200);
  await request("/api/v1/pages/terms", json(admin.cookie, "PUT", { ...body, isPublished: true }));
  const page = await request("/api/v1/pages/terms");
  expect(page.status).toBe(200);
  expect(((await page.json()) as { bodyHtml: string }).bodyHtml).toContain("<strong>kind</strong>");
  const listed = await request("/api/v1/pages", json(admin.cookie, "GET"));
  expect(listed.status).toBe(200);
  expect(((await listed.json()) as { items: object[] }).items[0]).not.toHaveProperty("bodySource");
  const source = await request("/api/v1/pages/terms/source", json(admin.cookie, "GET"));
  expect(source.status).toBe(200);
  expect(await source.json()).toMatchObject({ slug: "terms", bodySource: "Be [B]kind[/B]." });
  expect((await request("/api/v1/pages/terms/source", json(member.cookie, "GET"))).status).toBe(
    403,
  );
  expect((await request("/api/v1/pages/terms/source")).status).toBe(401);
  expect((await request("/api/v1/pages/nope/source", json(admin.cookie, "GET"))).status).toBe(404);
  expect((await request("/api/v1/pages/terms", json(admin.cookie, "DELETE"))).status).toBe(200);
  expect((await request("/api/v1/pages/terms")).status).toBe(404);
});

test("widgets are read by page without signing in; the rest needs admin.widgets", async () => {
  const { request, admin, member } = await setup();
  const guest = await request("/api/v1/widgets?page=novedades");
  expect(guest.status).toBe(200);
  const shown = (await guest.json()) as { items: { position: string; type: string }[] };
  expect(shown.items.some((item) => item.position === "novedades_sidebar")).toBe(true);
  expect((await request("/api/v1/widgets?page=nowhere")).status).toBe(400);

  expect((await request("/api/v1/widgets/all")).status).toBe(401);
  expect((await request("/api/v1/widgets/all", json(member.cookie, "GET"))).status).toBe(403);
  const refused = await request(
    "/api/v1/widgets",
    json(member.cookie, "POST", { position: "overview_top", type: "nothing" }),
  );
  expect(refused.status).toBe(403);

  const created = await request(
    "/api/v1/widgets",
    json(admin.cookie, "POST", {
      position: "overview_top",
      type: "recentlyActive",
      options: { window: "15m" },
    }),
  );
  expect(created.status).toBe(201);
  const made = (await created.json()) as { id: number; options: object };
  expect(made.options).toEqual({ window: "15m" });
  const copied = await request(
    `/api/v1/widgets/${made.id}/copies`,
    json(admin.cookie, "POST", { position: "overview_bottom" }),
  );
  expect(copied.status).toBe(201);
  const copy = (await copied.json()) as { id: number; position: string };
  expect(copy.position).toBe("overview_bottom");
  const patched = await request(
    `/api/v1/widgets/${made.id}`,
    json(admin.cookie, "PATCH", {
      type: "recentlyActive",
      position: "overview_top",
      title: null,
      phones: false,
      isEnabled: true,
      rule: { match: "all", conditions: [] },
      options: { window: "24h" },
    }),
  );
  expect(patched.status).toBe(200);
  expect(await patched.json()).toMatchObject({ phones: false, options: { window: "24h" } });
  const ordered = await request(
    "/api/v1/widgets/order",
    json(admin.cookie, "PUT", { position: "overview_bottom", ids: [copy.id] }),
  );
  expect(ordered.status).toBe(200);
  expect((await request(`/api/v1/widgets/${made.id}`, json(admin.cookie, "DELETE"))).status).toBe(
    200,
  );
});
