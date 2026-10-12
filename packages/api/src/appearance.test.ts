import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Ctx } from "@sermo/core";
import { closeContext, localDriver, schema } from "@sermo/core";
import { createTestContext } from "@sermo/core/testing";
import { frameGeometry } from "../../core/src/modules/images/frame-geometry";
import { createApp } from "./app";

const contexts: Ctx[] = [];
const dirs: string[] = [];
let nextIp = 1;
afterEach(async () => {
  for (const ctx of contexts.splice(0)) closeContext(ctx);
  for (const dir of dirs.splice(0))
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

const origin = "http://localhost:3000";

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "sermo-appearance-api-"));
  dirs.push(dir);
  const ctx = createTestContext();
  contexts.push(ctx);
  const app = createApp(ctx, {
    trustedProxyHeader: null,
    storage: { driver: localDriver(join(dir, "files")), tempDir: join(dir, "temp") },
  });
  const env = {
    requestIP: () => ({ address: `10.2.0.${nextIp++}`, family: "IPv4" as const, port: 1 }),
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
  const admin = await register("curator");
  ctx.sqlite.prepare("UPDATE users SET group_id = 4 WHERE id = ?1").run(admin.id);
  const member = await register("regular");
  return { ctx, request, admin, member };
}

const png = () =>
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==",
    "base64",
  );
const gif = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

function uploadRequest(cookie: string | null, purpose: string, bytes: Buffer, type: string) {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(bytes)], { type }), "picture");
  return [
    `/api/v1/files?purpose=${purpose}`,
    {
      method: "POST",
      headers: { origin, ...(cookie ? { cookie } : {}) },
      body: form,
    },
  ] as const;
}

const json = (cookie: string, method: string, body?: object): RequestInit => ({
  method,
  headers: { cookie, origin, "content-type": "application/json" },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

test("every catalog purpose is uploaded by an administrator only", async () => {
  const { request, admin, member } = await setup();
  const bytes = png();
  for (const purpose of schema.CATALOG_FILE_PURPOSES) {
    const guest = await request(...uploadRequest(null, purpose, bytes, "image/png"));
    expect(guest.status, `${purpose} guest`).toBe(401);
    const asMember = await request(...uploadRequest(member.cookie, purpose, bytes, "image/png"));
    expect(asMember.status, `${purpose} member`).toBe(403);
    const asAdmin = await request(...uploadRequest(admin.cookie, purpose, bytes, "image/png"));
    expect(asAdmin.status, `${purpose} admin`).toBe(201);
    const stored = (await asAdmin.json()) as { id: number; contentType: string };
    expect(stored.contentType).toBe(purpose === "site_icon" ? "image/png" : "image/webp");
    // GIF is not accepted for a catalog picture.
    const animated = await request(...uploadRequest(admin.cookie, purpose, gif, "image/gif"));
    expect(animated.status, `${purpose} gif`).toBe(400);
  }
  // An unknown purpose is still refused.
  const unknown = await request(...uploadRequest(admin.cookie, "banner", bytes, "image/png"));
  expect(unknown.status).toBe(400);
});

test("a frame goes from upload to catalog with its measured placement and an immutable URL", async () => {
  const { ctx, request, admin, member } = await setup();
  const fixture = await readFile(
    join(import.meta.dir, "../../core/src/modules/images/fixtures/frames/598.png"),
  );
  const upload = await request(...uploadRequest(admin.cookie, "frame", fixture, "image/png"));
  const file = (await upload.json()) as { id: number };
  const meta = ctx.sqlite
    .prepare<{ meta: string; width: number; height: number }, [number]>(
      "SELECT meta, width, height FROM files WHERE id = ?1",
    )
    .get(file.id)!;
  expect(JSON.parse(meta.meta).opening).not.toBeNull();

  const created = await request(
    "/api/v1/appearance/images",
    json(admin.cookie, "POST", { kind: "frame", name: "Ring", fileId: file.id }),
  );
  expect(created.status).toBe(201);
  const frame = (await created.json()) as {
    id: number;
    placement: { width: number; left: number; top: number; scale: number };
    image: { url: string };
  };
  expect(frame.placement).toEqual(
    frameGeometry(JSON.parse(meta.meta).opening, meta.width, meta.height),
  );

  const served = await request(frame.image.url);
  expect(served.status).toBe(200);
  expect(served.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");

  // Guests read the catalog; members cannot change it.
  const listed = await request("/api/v1/appearance/images?kind=frame");
  expect(((await listed.json()) as { items: { id: number }[] }).items.map((i) => i.id)).toEqual([
    frame.id,
  ]);
  const forbidden = await request(
    `/api/v1/appearance/images/${frame.id}`,
    json(member.cookie, "PATCH", { name: "Mine" }),
  );
  expect(forbidden.status).toBe(403);

  // placement: null reaches the operation as null (measure again).
  const custom = { width: 150, left: -20, top: -20, scale: 80 };
  const patched = await request(
    `/api/v1/appearance/images/${frame.id}`,
    json(admin.cookie, "PATCH", { placement: custom }),
  );
  expect(((await patched.json()) as { placement: unknown }).placement).toEqual(custom);
  const reset = await request(
    `/api/v1/appearance/images/${frame.id}`,
    json(admin.cookie, "PATCH", { placement: null }),
  );
  expect(reset.status).toBe(200);
  expect(((await reset.json()) as { placement: unknown }).placement).toEqual(frame.placement);

  const removed = await request(
    `/api/v1/appearance/images/${frame.id}`,
    json(admin.cookie, "DELETE"),
  );
  expect(await removed.json()).toEqual({ ok: true, deactivated: false });
});

test("the site and its palette are public", async () => {
  const { request, admin } = await setup();
  const site = await request("/api/v1/site");
  expect(site.status).toBe(200);
  const body = (await site.json()) as {
    name: string;
    palette: { accents: unknown[]; nameColors: unknown[]; prefixColors: unknown[] };
  };
  expect(body.name).toBe("Sermo");
  expect(body.palette.accents).toHaveLength(6);
  const created = await request(
    "/api/v1/appearance/colors",
    json(admin.cookie, "POST", { kind: "name", name: "Teal", color: "#008080" }),
  );
  expect(created.status).toBe(201);
  const again = (await (await request("/api/v1/site")).json()) as typeof body;
  expect(again.palette.nameColors).toHaveLength(12);
});
