import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Ctx } from "@sermo/core";
import { closeContext, localDriver, readSiteSettings } from "@sermo/core";
import { createTestContext } from "@sermo/core/testing";
import { HTTPException } from "hono/http-exception";
import { createApp } from "./app";
import { uploadMultipart } from "./upload";

const contexts: Ctx[] = [];
const dirs: string[] = [];
let nextIp = 1;

afterEach(async () => {
  for (const ctx of contexts.splice(0)) closeContext(ctx);
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function setup(storage = true) {
  const dir = await mkdtemp(join(tmpdir(), "sermo-review-upload-"));
  dirs.push(dir);
  const ctx = createTestContext();
  contexts.push(ctx);
  const app = createApp(ctx, {
    trustedProxyHeader: null,
    ...(storage
      ? { storage: { driver: localDriver(join(dir, "files")), tempDir: join(dir, "temp") } }
      : {}),
  });
  const env = {
    requestIP: () => ({ address: `10.1.0.${nextIp++}`, family: "IPv4" as const, port: 1 }),
  };
  const request = (path: string, init: RequestInit = {}) => app.request(path, init, env);
  const signUp = await request("/api/auth/sign-up/email", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost:3000",
      "x-forwarded-for": `198.51.100.${nextIp++}`,
    },
    body: JSON.stringify({
      name: "uploader",
      username: "uploader",
      email: "uploader@example.test",
      password: "Password123!",
    }),
  });
  expect(signUp.status).toBe(200);
  const cookie = signUp.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  const created = await request("/api/auth/api-key/create", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost:3000", cookie },
    body: JSON.stringify({ name: "test" }),
  });
  expect(created.status).toBe(200);
  const { key } = (await created.json()) as { key: string };
  return { dir, ctx, request, cookie, key };
}

const boundary = "XBOUNDARYX";
function part(headers: string, body: string) {
  return `--${boundary}\r\n${headers}\r\n\r\n${body}\r\n`;
}
const filePart = part(
  'Content-Disposition: form-data; name="file"; filename="a.txt"\r\nContent-Type: text/plain',
  "hello world",
);
const fieldPart = part('Content-Disposition: form-data; name="extra"', "x");
const end = `--${boundary}--\r\n`;

function post(
  state: Awaited<ReturnType<typeof setup>>,
  body: BodyInit | null,
  contentType = `multipart/form-data; boundary=${boundary}`,
  query = "",
) {
  return state.request(`/api/v1/files${query}`, {
    method: "POST",
    headers: {
      cookie: state.cookie,
      origin: "http://localhost:3000",
      "content-type": contentType,
    },
    body,
  });
}

async function leftovers(dir: string) {
  const names: string[] = [];
  for (const sub of ["files", "temp"])
    names.push(...(await readdir(join(dir, sub)).catch(() => [] as string[])));
  return names;
}
function fileRows(ctx: Ctx): number {
  return ctx.sqlite.prepare<{ n: number }, []>("SELECT COUNT(*) AS n FROM files").get()!.n;
}
async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 400));
}

test("a valid upload still succeeds", async () => {
  const state = await setup();
  const response = await post(state, filePart + end);
  expect(response.status).toBe(201);
  expect(fileRows(state.ctx)).toBe(1);
});

test("a file part followed by an extra field is rejected and nothing is stored", async () => {
  const state = await setup();
  const response = await post(state, filePart + fieldPart + end);
  expect(response.status).toBe(400);
  await settle();
  expect(fileRows(state.ctx)).toBe(0);
  expect(await leftovers(state.dir)).toEqual([]);
});

test("a second file part is rejected and nothing is stored", async () => {
  const state = await setup();
  const second = part(
    'Content-Disposition: form-data; name="file"; filename="b.txt"\r\nContent-Type: text/plain',
    "again",
  );
  const response = await post(state, filePart + second + end);
  expect(response.status).toBe(400);
  await settle();
  expect(fileRows(state.ctx)).toBe(0);
  expect(await leftovers(state.dir)).toEqual([]);
});

test("a truncated multipart body is a 400 and nothing is stored", async () => {
  const state = await setup();
  const response = await post(
    state,
    filePart + part('Content-Disposition: form-data; name="x"', "").slice(0, 20),
  );
  expect(response.status).toBe(400);
  expect(((await response.json()) as { error: { code: string } }).error.code).toBe("validation");
  await settle();
  expect(fileRows(state.ctx)).toBe(0);
  expect(await leftovers(state.dir)).toEqual([]);
});

test("a file cut off inside its content is a 400 and nothing is stored", async () => {
  const state = await setup();
  const response = await post(state, filePart.slice(0, filePart.length - 8));
  expect(response.status).toBe(400);
  await settle();
  expect(fileRows(state.ctx)).toBe(0);
  expect(await leftovers(state.dir)).toEqual([]);
});

test("multipart without a boundary is a 400 validation error", async () => {
  const state = await setup();
  const response = await post(state, "junk", "multipart/form-data; charset=utf-8");
  expect(response.status).toBe(400);
  expect(((await response.json()) as { error: { code: string } }).error.code).toBe("validation");
});

test("a non-multipart content type is a 415 with the error envelope", async () => {
  const state = await setup();
  for (const type of ["application/x-www-form-urlencoded", "text/plain", "application/json"]) {
    const response = await state.request("/api/v1/files", {
      method: "POST",
      headers: { authorization: `Bearer ${state.key}`, "content-type": type },
      body: "a=b",
    });
    expect(response.status).toBe(415);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
      "unsupported_media_type",
    );
  }
});

test("a bearer-token upload without a boundary is a 400 validation error", async () => {
  const state = await setup();
  const response = await state.request("/api/v1/files", {
    method: "POST",
    headers: { authorization: `Bearer ${state.key}`, "content-type": "multipart/form-data" },
    body: "junk",
  });
  expect(response.status).toBe(400);
  expect(((await response.json()) as { error: { code: string } }).error.code).toBe("validation");
});

test("a genuine storage failure is still a 500", async () => {
  const state = await setup();
  const blocker = join(state.dir, "temp");
  await Bun.write(blocker, "not a directory");
  const response = await post(state, filePart + end);
  expect(response.status).toBe(500);
});

test("uploadMultipart signals 415 with the error envelope for a non-multipart request", async () => {
  const state = await setup();
  const request = new Request("http://localhost/api/v1/files", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "a=b",
  });
  const error = await uploadMultipart(
    state.ctx,
    { kind: "guest" } as never,
    request,
    { driver: localDriver(join(state.dir, "files")), tempDir: join(state.dir, "temp") },
    "attachment",
  ).catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(HTTPException);
  const response = (error as HTTPException).getResponse();
  expect(response.status).toBe(415);
  expect(await response.json()).toEqual({
    error: { code: "unsupported_media_type", message: "Content-Type must be multipart/form-data." },
  });
});

test("an upload over the configured limit is rejected by the application with the error envelope", async () => {
  const state = await setup();
  const settings = readSiteSettings(state.ctx);
  state.ctx.sqlite
    .prepare("INSERT INTO site_settings (key, value, updated_at) VALUES ('configuration', ?1, 0)")
    .run(JSON.stringify({ ...settings, maxUploadBytes: 64 }));
  const big = part(
    'Content-Disposition: form-data; name="file"; filename="a.txt"\r\nContent-Type: text/plain',
    "x".repeat(500),
  );
  const response = await post(state, big + end);
  expect(response.status).toBe(400);
  const body = (await response.json()) as { error: { code: string; message: string } };
  expect(body.error.code).toBe("validation");
  expect(body.error.message).toContain("upload limit");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  await settle();
  expect(fileRows(state.ctx)).toBe(0);
  expect(await leftovers(state.dir)).toEqual([]);
});
