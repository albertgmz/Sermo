import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Ctx } from "@sermo/core";
import { closeContext, ensureAdmin, localDriver, operations, schema } from "@sermo/core";
import { createTestContext, insertNode } from "@sermo/core/testing";
import { coerceQueryValues, createApp } from "./app";
import { buildOpenApiDocument } from "./openapi";
import { routes } from "./routes";

const contexts: Ctx[] = [];
const uploadDirs: string[] = [];
let nextIp = 1;
function setup(options: Parameters<typeof createApp>[1] = { trustedProxyHeader: null }) {
  const ctx = createTestContext();
  contexts.push(ctx);
  const app = createApp(ctx, options);
  const ip = `10.0.0.${nextIp++}`;
  const env = { requestIP: () => ({ address: ip, family: "IPv4" as const, port: 1 }) };
  const request = (path: string, init: RequestInit = {}) => app.request(path, init, env);
  return { ctx, app, request, env };
}
afterEach(async () => {
  for (const ctx of contexts.splice(0)) closeContext(ctx);
  for (const dir of uploadDirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

function sessionCookies(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
}
async function register(request: ReturnType<typeof setup>["request"], username = "alice") {
  const clientIp = `198.51.100.${nextIp++}`;
  const response = await request("/api/auth/sign-up/email", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost:3000",
      "x-forwarded-for": clientIp,
    },
    body: JSON.stringify({
      name: username,
      username,
      email: `${username}@example.test`,
      password: "Password123!",
    }),
  });
  expect(response.status).toBe(200);
  return {
    cookie: sessionCookies(response),
    data: (await response.json()) as { user: { id: string } },
  };
}

test("the wrong-password limit answers 429 with the body of the request limiter", async () => {
  const { request } = setup();
  const { cookie } = await register(request);
  const verify = () =>
    request("/api/v1/me/verify-password", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:3000", cookie },
      body: JSON.stringify({ password: "not-the-password" }),
    });
  for (let i = 0; i < 5; i++) expect((await verify()).status).toBe(403);
  const limited = await verify();
  expect(limited.status).toBe(429);
  expect(await limited.json()).toEqual({
    error: {
      code: "rate_limited",
      message: "Too many wrong passwords. Try again later.",
      issues: [{ path: ["password"], message: "Too many wrong passwords" }],
    },
  });
});

test("Better Auth's own password endpoints are held to the wrong-password limit", async () => {
  const { app, request } = setup();
  const { cookie } = await register(request);
  let address = 1;
  // Each call comes from a new address, so only the per-member limit can stop it.
  const post = (path: string, body: object) =>
    app.request(
      path,
      {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost:3000", cookie },
        body: JSON.stringify(body),
      },
      {
        requestIP: () => ({ address: `203.0.113.${address++}`, family: "IPv4" as const, port: 1 }),
      },
    );
  const change = (currentPassword: string) =>
    post("/api/auth/change-password", { currentPassword, newPassword: "Another-secret-9" });

  // The endpoint that only answers "is this my password" is not offered over HTTP.
  expect((await post("/api/auth/verify-password", { password: "Password123!" })).status).toBe(404);

  for (let i = 0; i < 4; i++) expect((await change("wrong-wrong-1")).status).toBe(400);
  // A right answer works, and gives back its own guess without clearing the wrong ones.
  expect((await change("Password123!")).status).toBe(200);
  const fifth = await change("wrong-wrong-1");
  expect(fifth.status).toBe(400);
  const limited = await change("Another-secret-9");
  expect(limited.status).toBe(429);
  expect(await limited.json()).toMatchObject({ code: "TOO_MANY_ATTEMPTS" });
  // The forum's own check shares the same count.
  const verify = await app.request(
    "/api/v1/me/verify-password",
    {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:3000", cookie },
      body: JSON.stringify({ password: "Another-secret-9" }),
    },
    { requestIP: () => ({ address: "203.0.113.250", family: "IPv4" as const, port: 1 }) },
  );
  expect(verify.status).toBe(429);
});

test("route table has exactly one entry for each operation", () => {
  expect(routes.length).toBe(operations.length);
  expect(new Set(routes.map((route) => route.operation)).size).toBe(routes.length);
  expect(new Set(operations.map((op) => op.name))).toEqual(
    new Set(routes.map((route) => route.operation)),
  );
});

test("query coercion handles booleans, integer arrays, and strict integer syntax", () => {
  expect(coerceQueryValues(["true"], { type: "boolean" })).toBe(true);
  const nullableId = { anyOf: [{ type: "integer" }, { type: "null" }] };
  expect(coerceQueryValues(["12"], nullableId)).toBe(12);
  expect(coerceQueryValues(["null"], nullableId)).toBeNull();
  expect(coerceQueryValues(["x"], nullableId)).toBe("x");
  expect(coerceQueryValues(["false"], { type: "boolean" })).toBe(false);
  expect(coerceQueryValues(["1", "2"], { type: "array", items: { type: "integer" } })).toEqual([
    1, 2,
  ]);
  for (const value of ["0x1", "1e0", "1.0", " 1", "1 "])
    expect(coerceQueryValues([value], { type: "integer" })).toBe(value);
});

test("OpenAPI covers REST and Better Auth routes with resolvable references", async () => {
  const { ctx } = setup();
  const document = (await buildOpenApiDocument(ctx)) as {
    paths: Record<string, Record<string, { operationId: string }>>;
    components: {
      schemas: Record<string, unknown>;
      securitySchemes: Record<string, { name: string }>;
    };
  };
  for (const route of routes)
    expect(document.paths[`/api/v1${route.path}`]?.[route.method.toLowerCase()]?.operationId).toBe(
      route.operation,
    );
  expect(document.paths["/api/auth/sign-up/email"]?.post).toBeDefined();
  expect(document.paths["/api/auth/api-key/create"]?.post).toBeDefined();
  const upload = document.paths["/api/v1/files"]?.post as unknown as {
    parameters: { name: string; schema: { enum: string[] } }[];
  };
  const purposes = upload.parameters.find((parameter) => parameter.name === "purpose")!.schema.enum;
  expect(purposes).toEqual([...schema.FILE_PURPOSES]);
  expect(purposes.length).toBeGreaterThan(5);
  for (const [path, method] of [
    ["/api/auth/send-verification-email", "post"],
    ["/api/auth/verify-email", "get"],
    ["/api/auth/request-password-reset", "post"],
    ["/api/auth/reset-password", "post"],
    ["/api/auth/change-password", "post"],
    ["/api/auth/change-email", "post"],
  ] as const)
    expect(document.paths[path]?.[method]).toBeDefined();
  expect(document.components.securitySchemes.sessionCookie?.name).toBe("sermo.session_token");
  expect(document.components.securitySchemes.secureSessionCookie?.name).toBe(
    "__Secure-sermo.session_token",
  );
  const ids: string[] = [];
  const refs: string[] = [];
  const visit = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    for (const [name, item] of Object.entries(value)) {
      if (name === "$ref") refs.push(String(item));
      else visit(item);
    }
  };
  for (const path of Object.values(document.paths))
    for (const endpoint of Object.values(path)) {
      ids.push(endpoint.operationId);
      visit(endpoint);
    }
  expect(new Set(ids).size).toBe(ids.length);
  for (const ref of refs)
    expect(document.components.schemas[ref.replace("#/components/schemas/", "")]).toBeDefined();
});

test("errors, coercion, health, and security headers", async () => {
  const { request } = setup();
  const health = await request("/health");
  expect(health.status).toBe(200);
  expect(await health.json()).toEqual({ status: "ok" });
  const nodes = await request("/api/v1/nodes");
  expect(nodes.headers.get("content-security-policy")).toBe(
    "default-src 'none'; frame-ancestors 'none'",
  );
  expect(nodes.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
  const invalid = await request("/api/v1/nodes/nope");
  expect(invalid.status).toBe(400);
  expect(((await invalid.json()) as { error: { code: string } }).error.code).toBe("validation");
  const missing = await request("/api/v1/nodes/999");
  expect(missing.status).toBe(404);
  expect(await missing.json()).toEqual({
    error: { code: "not_found", message: "The requested item could not be found." },
  });
  const method = await request("/api/v1/nodes", { method: "PUT" });
  expect(method.status).toBe(405);
  expect(method.headers.get("allow")).toContain("GET");
  expect(method.headers.get("allow")).toContain("HEAD");
  expect(await method.json()).toEqual({
    error: { code: "method_not_allowed", message: "Method not allowed." },
  });
  const unknown = await request("/nothing");
  expect(unknown.status).toBe(404);
  expect(((await unknown.json()) as { error: { code: string } }).error.code).toBe("not_found");
  const malformed = await request("/api/v1/nodes", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{",
  });
  // Creating a forum is not for a guest: the body is not looked at.
  expect(malformed.status).toBe(401);
  const { cookie } = await register(request);
  const memberMalformed = await request("/api/v1/nodes/1/threads", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost:3000", cookie },
    body: "{",
  });
  expect(memberMalformed.status).toBe(400);
  expect(await memberMalformed.json()).toEqual({
    error: { code: "validation", message: "Malformed JSON body." },
  });
  for (const value of ["0x1", "1e0", "1.0", "%201", "1%20"]) {
    const bad = await request(`/api/v1/nodes/${value}`);
    expect(bad.status).toBe(400);
  }
  expect((await request("/mcp")).headers.get("x-content-type-options")).toBe("nosniff");
});

test("a refusal reaches a Spanish reader in Spanish, by cookie or Accept-Language", async () => {
  const { request } = setup();
  const missing = async (headers: Record<string, string>) =>
    (
      (await (await request("/api/v1/nodes/999", { headers })).json()) as {
        error: { message: string };
      }
    ).error.message;
  expect(await missing({})).toBe("The requested item could not be found.");
  expect(await missing({ cookie: "forum_locale=es" })).toBe("No se encontró lo que pides.");
  expect(await missing({ "accept-language": "es-CU,es;q=0.9" })).toBe(
    "No se encontró lo que pides.",
  );
  expect(await missing({ "accept-language": "en;q=0.5, es;q=0.9" })).toBe(
    "No se encontró lo que pides.",
  );
  expect(await missing({ cookie: "forum_locale=en", "accept-language": "es" })).toBe(
    "The requested item could not be found.",
  );
});

test("the file storage refusal (503) reaches a Spanish reader in Spanish", async () => {
  const { request } = setup();
  const answer = await request("/api/v1/files/1", { headers: { cookie: "forum_locale=es" } });
  expect(answer.status).toBe(503);
  expect(((await answer.json()) as { error: { message: string } }).error.message).toBe(
    "El almacenamiento de archivos no está disponible.",
  );
});

test("database failure returns a generic 500 and unhealthy status", async () => {
  const { request, ctx } = setup();
  contexts.pop();
  closeContext(ctx);
  const health = await request("/health");
  expect(health.status).toBe(503);
  const response = await request("/api/v1/nodes");
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({
    error: { code: "internal", message: "Internal server error." },
  });
  expect(response.headers.get("content-security-policy")).toContain("default-src 'none'");
});

test("Better Auth sessions, username sign-in, sign-out, and API keys", async () => {
  const { request } = setup();
  const { cookie } = await register(request);
  expect((await request("/api/v1/me", { headers: { cookie } })).status).toBe(200);
  const signIn = await request("/api/auth/sign-in/username", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost:3000" },
    body: JSON.stringify({ username: "alice", password: "Password123!" }),
  });
  expect(signIn.status).toBe(200);
  const signInEmail = await request("/api/auth/sign-in/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost:3000" },
    body: JSON.stringify({ email: "alice@example.test", password: "Password123!" }),
  });
  expect(signInEmail.status).toBe(200);
  expect(signInEmail.headers.get("content-security-policy")).toContain("default-src 'none'");
  const currentCookie = sessionCookies(signInEmail);
  const tokenOnly = currentCookie
    .split("; ")
    .find((part) => part.startsWith("sermo.session_token="));
  const refreshed = await request("/api/v1/me", { headers: { cookie: tokenOnly! } });
  expect(refreshed.status).toBe(200);
  expect(
    refreshed.headers.getSetCookie().some((value) => value.startsWith("sermo.session_data=")),
  ).toBe(true);
  const created = await request("/api/auth/api-key/create", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost:3000",
      cookie: currentCookie,
    },
    body: JSON.stringify({ name: "test", password: "Password123!" }),
  });
  expect(created.status).toBe(200);
  const key = (await created.json()) as { id: string; key: string };
  expect(
    (await request("/api/v1/me", { headers: { authorization: `Bearer ${key.key}` } })).status,
  ).toBe(200);
  expect(
    (
      await request("/api/auth/api-key/create", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${key.key}` },
        body: "{}",
      })
    ).status,
  ).toBe(401);
  const revoked = await request("/api/auth/api-key/delete", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost:3000",
      cookie: currentCookie,
    },
    body: JSON.stringify({ keyId: key.id }),
  });
  expect(revoked.status).toBe(200);
  expect(
    (await request("/api/v1/me", { headers: { authorization: `Bearer ${key.key}` } })).status,
  ).toBe(401);
  expect(
    (
      await request("/api/auth/sign-out", {
        method: "POST",
        headers: { origin: "http://localhost:3000", cookie: currentCookie },
      })
    ).status,
  ).toBe(200);
  expect((await request("/api/v1/me", { headers: { cookie: tokenOnly! } })).status).toBe(401);
});

test("cookie writes enforce CSRF and JSON while API keys can write", async () => {
  const { request } = setup();
  const { cookie } = await register(request);
  const crossSite = await request("/api/v1/profile", {
    method: "PATCH",
    headers: { cookie, origin: "https://evil.example", "content-type": "text/plain" },
    body: JSON.stringify({ about: "Form body" }),
  });
  expect(crossSite.status).toBe(403);
  expect(((await crossSite.json()) as { error: { code: string } }).error.code).toBe("forbidden");
  const created = await request("/api/auth/api-key/create", {
    method: "POST",
    headers: { cookie, origin: "http://localhost:3000", "content-type": "application/json" },
    body: JSON.stringify({ name: "csrf", password: "Password123!" }),
  });
  expect(created.status).toBe(200);
  const key = ((await created.json()) as { key: string }).key;
  const keyForm = await request("/api/v1/profile", {
    method: "PATCH",
    headers: {
      authorization: `Bearer ${key}`,
      origin: "https://evil.example",
      "content-type": "text/plain",
    },
    body: JSON.stringify({ about: "Form body" }),
  });
  expect(keyForm.status).toBe(200);
  expect(
    (
      await request("/api/v1/profile", {
        method: "PATCH",
        headers: { cookie, origin: "http://localhost:3000" },
        body: "{}",
      })
    ).status,
  ).toBe(415);
  expect(
    (
      await request("/api/v1/profile", {
        method: "PATCH",
        headers: { cookie, origin: "http://localhost:3000", "content-type": "application/json" },
        body: JSON.stringify({ about: "Hi" }),
      })
    ).status,
  ).toBe(200);
});

test("cross-site multipart upload with a session cookie is rejected", async () => {
  const { request } = setup();
  const { cookie } = await register(request, "uploader");
  const form = new FormData();
  form.append("file", new Blob(["file data"], { type: "text/plain" }), "note.txt");
  for (const origin of ["https://evil.example", undefined]) {
    const response = await request("/api/v1/files", {
      method: "POST",
      headers: { cookie, ...(origin ? { origin } : {}) },
      body: form,
    });
    expect(response.status).toBe(403);
  }
  const sameSite = await request("/api/v1/files", {
    method: "POST",
    headers: { cookie, origin: "http://localhost:3000" },
    body: form,
  });
  expect(sameSite.status).not.toBe(403);
  expect(sameSite.status).not.toBe(415);
});

/** The 201 body of an upload must have exactly the fields the OpenAPI document lists, of those types. */
async function expectDocumentedUploadAnswer(
  request: ReturnType<typeof setup>["request"],
  answer: object,
) {
  const document = (await (await request("/api/v1/openapi.json")).json()) as {
    paths: Record<string, Record<string, unknown>>;
  };
  const documented = (
    document.paths["/api/v1/files"]!.post as {
      responses: Record<
        string,
        {
          content: {
            "application/json": {
              schema: {
                required: string[];
                properties: Record<string, { type: string; minimum?: number }>;
              };
            };
          };
        }
      >;
    }
  ).responses["201"]!.content["application/json"].schema;
  const fields = Object.entries(answer);
  expect(fields.map(([name]) => name).sort()).toEqual(Object.keys(documented.properties).sort());
  expect([...documented.required].sort()).toEqual(Object.keys(documented.properties).sort());
  for (const [name, value] of fields) {
    const property = documented.properties[name]!;
    if (property.type === "integer") {
      expect(Number.isInteger(value), name).toBe(true);
      expect(value as number, name).toBeGreaterThanOrEqual(property.minimum ?? -Infinity);
    } else {
      expect(property.type, name).toBe("string");
      expect(typeof value, name).toBe("string");
    }
  }
}

test("an upload over the write limit answers 429 with the request limiter's body", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sermo-api-files-"));
  uploadDirs.push(dir);
  const { request } = setup({
    trustedProxyHeader: null,
    rateLimits: { write: 1 },
    storage: { driver: localDriver(join(dir, "files")), tempDir: join(dir, "temp") },
  });
  const { cookie } = await register(request, "uploader");
  const send = () => {
    const form = new FormData();
    form.append("file", new Blob(["x"], { type: "text/plain" }), "note.txt");
    return request("/api/v1/files", {
      method: "POST",
      headers: { cookie, origin: "http://localhost:3000" },
      body: form,
    });
  };
  expect((await send()).status).toBe(201);
  const limited = await send();
  expect(limited.status).toBe(429);
  expect(limited.headers.get("retry-after")).toBeTruthy();
  expect(((await limited.json()) as { error: { code: string } }).error.code).toBe("rate_limited");
});

test("multipart upload streams through the API and serves with nosniff", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sermo-api-files-"));
  uploadDirs.push(dir);
  const { request } = setup({
    trustedProxyHeader: null,
    storage: { driver: localDriver(join(dir, "files")), tempDir: join(dir, "temp") },
  });
  const { cookie, data } = await register(request, "fileowner");
  const form = new FormData();
  form.append("file", new Blob(["hello from storage"], { type: "text/plain" }), "note.txt");
  const upload = await request("/api/v1/files", {
    method: "POST",
    headers: { cookie, origin: "http://localhost:3000" },
    body: form,
  });
  expect(upload.status).toBe(201);
  const file = (await upload.json()) as { id: number; url: string };
  expect(file.url).toBe(`/api/v1/files/${file.id}`);
  await expectDocumentedUploadAnswer(request, file);
  const hidden = await request(file.url);
  expect(hidden.status).toBe(404);
  const served = await request(file.url, { headers: { cookie } });
  expect(served.status).toBe(200);
  expect(served.headers.get("x-content-type-options")).toBe("nosniff");
  expect(served.headers.get("content-disposition")).toContain("attachment");
  expect(await served.text()).toBe("hello from storage");

  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==",
    "base64",
  );
  const avatarForm = new FormData();
  avatarForm.append("file", new Blob([png], { type: "image/png" }), "avatar.png");
  const avatarUpload = await request("/api/v1/files?purpose=avatar", {
    method: "POST",
    headers: { cookie, origin: "http://localhost:3000" },
    body: avatarForm,
  });
  expect(avatarUpload.status).toBe(201);
  const avatar = (await avatarUpload.json()) as { id: number };
  await expectDocumentedUploadAnswer(request, avatar);
  const set = await request("/api/v1/profile/avatar", {
    method: "PUT",
    headers: { cookie, origin: "http://localhost:3000", "content-type": "application/json" },
    body: JSON.stringify({ fileId: avatar.id }),
  });
  expect(set.status).toBe(200);
  const profile = await request(`/api/v1/users/${data.user.id}`);
  const avatarUrl = ((await profile.json()) as { avatar: { fileId: number; url: string } }).avatar;
  expect(avatarUrl.fileId).toBe(avatar.id);
  // The middleware leaves a value the route set: a public picture keeps its year, a private file
  // its own no-store.
  const picture = await request(avatarUrl.url);
  expect(picture.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
  expect(served.headers.get("cache-control")).toContain("private");
});

test("a picture anyone may see is served when the session cookie is dead", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sermo-api-files-"));
  uploadDirs.push(dir);
  const { request, ctx } = setup({
    trustedProxyHeader: null,
    storage: { driver: localDriver(join(dir, "files")), tempDir: join(dir, "temp") },
  });
  const { cookie, data } = await register(request, "stalecookie");
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==",
    "base64",
  );
  const upload = async (purpose: string, blob: Blob, name: string) => {
    const form = new FormData();
    form.append("file", blob, name);
    const response = await request(`/api/v1/files?purpose=${purpose}`, {
      method: "POST",
      headers: { cookie, origin: "http://localhost:3000" },
      body: form,
    });
    expect(response.status).toBe(201);
    return ((await response.json()) as { id: number; url: string }).id;
  };
  const avatar = await upload("avatar", new Blob([png], { type: "image/png" }), "a.png");
  const note = await upload("attachment", new Blob(["x"], { type: "text/plain" }), "n.txt");
  expect(
    (
      await request("/api/v1/profile/avatar", {
        method: "PUT",
        headers: { cookie, origin: "http://localhost:3000", "content-type": "application/json" },
        body: JSON.stringify({ fileId: avatar }),
      })
    ).status,
  ).toBe(200);
  const dead = "sermo.session_token=gone";
  const served = await request(`/api/v1/files/${avatar}`, { headers: { cookie: dead } });
  expect(served.status).toBe(200);
  expect(served.headers.get("content-type")).toStartWith("image/");
  // What a guest may not read stays hidden, and every other route still refuses a dead cookie.
  expect((await request(`/api/v1/files/${note}`, { headers: { cookie: dead } })).status).toBe(404);
  expect((await request("/api/v1/me", { headers: { cookie: dead } })).status).toBe(401);
  // Only the cookie falls back: a bad API key or bearer token and a malformed header are refused.
  for (const headers of <Record<string, string>[]>[
    { authorization: "Bearer sermo_nope" },
    { "x-api-key": "sermo_nope" },
    { authorization: "Basic abc" },
  ])
    expect((await request(`/api/v1/files/${avatar}`, { headers })).status).toBe(401);
  // A banned member is refused too, not treated as a guest.
  ctx.sqlite
    .prepare("UPDATE users SET banned_permanently = 1 WHERE id = ?1")
    .run(Number(data.user.id));
  expect((await request(`/api/v1/files/${avatar}`, { headers: { cookie } })).status).toBe(403);
});

test("rate limits preserve headers and separate guest IPs", async () => {
  const { request } = setup({
    trustedProxyHeader: "x-forwarded-for",
    rateLimits: { read: 1, search: 1, write: 1, mcp: 1 },
    rateLimitWindowMs: 100,
  });
  expect(
    (
      await request("/api/v1/nodes", {
        headers: { "x-forwarded-for": "spoofed, 192.0.2.1", "x-sermo-client-ip": "fake" },
      })
    ).status,
  ).toBe(200);
  const limited = await request("/api/v1/nodes", {
    headers: { "x-forwarded-for": "spoofed, 192.0.2.1" },
  });
  expect(limited.status).toBe(429);
  expect(limited.headers.get("retry-after")).toBeTruthy();
  expect(limited.headers.get("ratelimit-limit")).toBe("1");
  expect(limited.headers.get("x-content-type-options")).toBe("nosniff");
  expect(((await limited.json()) as { error: { code: string } }).error.code).toBe("rate_limited");
  expect(
    (await request("/api/v1/nodes", { headers: { "x-forwarded-for": "spoofed, 192.0.2.2" } }))
      .status,
  ).toBe(200);
  expect((await request("/api/v1/search?q=test")).status).not.toBe(429);
  const searchLimited = await request("/api/v1/search?q=test");
  expect(searchLimited.status).toBe(429);
  expect(searchLimited.headers.get("retry-after")).toBeTruthy();
  expect(((await searchLimited.json()) as { error: { code: string } }).error.code).toBe(
    "rate_limited",
  );
  const mcp = await request("/mcp");
  expect(mcp.status).not.toBe(429);
  expect(mcp.headers.get("content-security-policy")).toContain("default-src 'none'");
  const mcpLimited = await request("/mcp");
  expect(mcpLimited.status).toBe(429);
  expect(mcpLimited.headers.get("retry-after")).toBeTruthy();
  expect(((await mcpLimited.json()) as { error: { code: string } }).error.code).toBe(
    "rate_limited",
  );
  const write = {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ parentId: null, type: "forum", title: "Guest" }),
  };
  expect((await request("/api/v1/nodes", write)).status).toBe(401);
  const writeLimited = await request("/api/v1/nodes", write);
  expect(writeLimited.status).toBe(429);
  expect(writeLimited.headers.get("retry-after")).toBeTruthy();
  expect(((await writeLimited.json()) as { error: { code: string } }).error.code).toBe(
    "rate_limited",
  );
  await Bun.sleep(120);
  expect(
    (await request("/api/v1/nodes", { headers: { "x-forwarded-for": "spoofed, 192.0.2.1" } }))
      .status,
  ).toBe(200);
});

test("HEAD is limited like GET, including search", async () => {
  const { request } = setup({ trustedProxyHeader: null, rateLimits: { read: 1, search: 1 } });
  const first = await request("/api/v1/nodes", { method: "HEAD" });
  expect(first.status).toBe(200);
  const second = await request("/api/v1/nodes", { method: "HEAD" });
  expect(second.status).toBe(429);
  expect(second.headers.get("retry-after")).toBeTruthy();
  const search = await request("/api/v1/search?q=word", { method: "HEAD" });
  expect(search.status).toBe(200);
  const searchLimited = await request("/api/v1/search?q=word", { method: "HEAD" });
  expect(searchLimited.status).toBe(429);
  expect(searchLimited.headers.get("retry-after")).toBeTruthy();
});

test("client-supplied IP is ignored when the socket provides addresses", async () => {
  const { app } = setup({ trustedProxyHeader: null, rateLimits: { read: 1 } });
  const requestFrom = (address: string) =>
    app.request(
      "/api/v1/nodes",
      {
        headers: { "x-sermo-client-ip": "spoofed" },
      },
      { requestIP: () => ({ address, family: "IPv4" as const, port: 1 }) },
    );
  expect((await requestFrom("192.0.2.1")).status).toBe(200);
  expect((await requestFrom("192.0.2.2")).status).toBe(200);
  expect((await requestFrom("192.0.2.1")).status).toBe(429);
});

test("session read limits are per user", async () => {
  const { request } = setup({ trustedProxyHeader: "x-forwarded-for", rateLimits: { read: 1 } });
  const first = await register(request, "readerone");
  const second = await register(request, "readertwo");
  expect((await request("/api/v1/nodes", { headers: { cookie: first.cookie } })).status).toBe(200);
  const limited = await request("/api/v1/nodes", { headers: { cookie: first.cookie } });
  expect(limited.status).toBe(429);
  expect(limited.headers.get("retry-after")).toBeTruthy();
  expect(((await limited.json()) as { error: { code: string } }).error.code).toBe("rate_limited");
  expect((await request("/api/v1/nodes", { headers: { cookie: second.cookie } })).status).toBe(200);
});

test("REST maps forbidden and conflict errors and path fields override JSON", async () => {
  const { request, ctx } = setup({ trustedProxyHeader: "x-forwarded-for" });
  await ensureAdmin(ctx, {
    username: "siteadmin",
    email: "siteadmin@example.test",
    password: "Password123!",
  });
  const member = await register(request, "regular");
  const forbidden = await request("/api/v1/groups/2", {
    method: "PATCH",
    headers: {
      cookie: member.cookie,
      origin: "http://localhost:3000",
      "content-type": "application/json",
    },
    body: JSON.stringify({ title: "No access" }),
  });
  expect(forbidden.status).toBe(403);
  expect(((await forbidden.json()) as { error: { code: string } }).error.code).toBe("forbidden");
  const signedIn = await request("/api/auth/sign-in/email", {
    method: "POST",
    headers: {
      origin: "http://localhost:3000",
      "content-type": "application/json",
      "x-forwarded-for": "198.51.100.40",
    },
    body: JSON.stringify({ email: "siteadmin@example.test", password: "Password123!" }),
  });
  expect(signedIn.status).toBe(200);
  const adminCookie = sessionCookies(signedIn);
  const changed = await request("/api/v1/groups/2", {
    method: "PATCH",
    headers: {
      cookie: adminCookie,
      origin: "http://localhost:3000",
      "content-type": "application/json",
    },
    body: '{"groupId":3,"title":"Renamed members","actorPassword":"Password123!","__proto__":{"polluted":true},"constructor":{"x":1},"prototype":{"x":1}}',
  });
  expect(changed.status).toBe(200);
  expect((await changed.json()) as { id: number; title: string }).toMatchObject({
    id: 2,
    title: "Renamed members",
  });
  expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  // Built-in groups cannot be deleted: the replaced groups API's conflict case.
  const conflict = await request("/api/v1/groups/2?actorPassword=Password123!", {
    method: "DELETE",
    headers: {
      cookie: adminCookie,
      origin: "http://localhost:3000",
      "content-type": "application/json",
    },
  });
  expect(conflict.status).toBe(409);
  expect(((await conflict.json()) as { error: { code: string } }).error.code).toBe("conflict");
});

test("guest cannot create content through the REST adapter", async () => {
  const { request, ctx } = setup();
  const forum = insertNode(ctx, { type: "forum" });
  const response = await request(`/api/v1/nodes/${forum.id}/threads`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: "Hello", body: "Hi" }),
  });
  expect(response.status).toBe(401);
});

test("expired sessions and invalid authorization return 401", async () => {
  const { request, ctx } = setup();
  const { cookie } = await register(request);
  const tokenCookie = cookie.split("; ").find((part) => part.startsWith("sermo.session_token="));
  expect(tokenCookie).toBeDefined();
  ctx.sqlite.query("UPDATE auth_session SET expires_at = 0").run();
  const expired = await request("/api/v1/me", { headers: { cookie: tokenCookie! } });
  expect(expired.status).toBe(401);
  expect(((await expired.json()) as { error: { code: string } }).error.code).toBe(
    "unauthenticated",
  );
  expect((await request("/api/v1/me", { headers: { authorization: "Basic abc" } })).status).toBe(
    401,
  );
});

test("API-key write bypasses cookie CSRF and a second user has an independent limit", async () => {
  const { request, ctx } = setup({
    trustedProxyHeader: "x-forwarded-for",
    rateLimits: { write: 2 },
  });
  const first = await register(request, "first");
  const second = await register(request, "second");
  const created = await request("/api/auth/api-key/create", {
    method: "POST",
    headers: {
      cookie: first.cookie,
      origin: "http://localhost:3000",
      "content-type": "application/json",
    },
    body: JSON.stringify({ name: "write", password: "Password123!" }),
  });
  expect(created.status).toBe(200);
  const key = ((await created.json()) as { key: string }).key;
  const forum = insertNode(ctx, { type: "forum" });
  const firstWrite = await request(`/api/v1/nodes/${forum.id}/threads`, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ title: "Key thread", body: "Written by key" }),
  });
  expect(firstWrite.status).toBe(201);
  const secondWrite = await request(`/api/v1/nodes/${forum.id}/threads`, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ title: "Another key thread", body: "Written by key" }),
  });
  expect(secondWrite.status).toBe(201);
  expect(
    (
      await request(`/api/v1/nodes/${forum.id}/threads`, {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify({ title: "Limited", body: "Written by key" }),
      })
    ).status,
  ).toBe(429);
  expect(
    (
      await request(`/api/v1/nodes/${forum.id}/threads`, {
        method: "POST",
        headers: {
          cookie: second.cookie,
          origin: "http://localhost:3000",
          "content-type": "application/json",
        },
        body: JSON.stringify({ title: "Second user", body: "Allowed" }),
      })
    ).status,
  ).toBe(201);
});

test("real MCP route lists and calls tools with an API key and refreshes session cookies", async () => {
  const { request } = setup();
  const { cookie } = await register(request, "mcpuser");
  const created = await request("/api/auth/api-key/create", {
    method: "POST",
    headers: { cookie, origin: "http://localhost:3000", "content-type": "application/json" },
    body: JSON.stringify({ name: "mcp", password: "Password123!" }),
  });
  expect(created.status).toBe(200);
  const key = ((await created.json()) as { key: string }).key;
  const post = (method: string, headers: HeadersInit, id: number, params?: object) =>
    request("/mcp", {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        ...headers,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}) }),
    });
  const listed = await post("tools/list", { authorization: `Bearer ${key}` }, 1);
  expect(listed.status).toBe(200);
  const listResult = (await listed.json()) as { result: { tools: { name: string }[] } };
  expect(listResult.result.tools.some((tool) => tool.name === "auth_me")).toBe(true);
  const called = await post("tools/call", { authorization: `Bearer ${key}` }, 2, {
    name: "auth_me",
    arguments: {},
  });
  expect(called.status).toBe(200);
  const callResult = (await called.json()) as {
    result: { structuredContent: { user: { username: string } } };
  };
  expect(callResult.result.structuredContent.user.username).toBe("mcpuser");
  const tokenOnly = cookie.split("; ").find((part) => part.startsWith("sermo.session_token="));
  const session = await post("tools/list", { cookie: tokenOnly! }, 3);
  expect(session.status).toBe(200);
  expect(
    session.headers.getSetCookie().filter((value) => value.startsWith("sermo.session_data=")),
  ).toHaveLength(1);
});

test("thread, reply, reaction, listing, and search work over HTTP", async () => {
  const { request, ctx } = setup({ trustedProxyHeader: "x-forwarded-for" });
  const author = await register(request, "author");
  const reader = await register(request, "reader");
  await ensureAdmin(ctx, {
    username: "forumadmin",
    email: "forumadmin@example.test",
    password: "Password123!",
  });
  const json = (cookie: string, body: object): RequestInit => ({
    method: "POST",
    headers: { cookie, origin: "http://localhost:3000", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const adminSignIn = await request("/api/auth/sign-in/email", {
    method: "POST",
    headers: {
      origin: "http://localhost:3000",
      "content-type": "application/json",
      "x-forwarded-for": "198.51.100.41",
    },
    body: JSON.stringify({ email: "forumadmin@example.test", password: "Password123!" }),
  });
  expect(adminSignIn.status).toBe(200);
  const forumCreated = await request(
    "/api/v1/nodes",
    json(sessionCookies(adminSignIn), { parentId: null, type: "forum", title: "General" }),
  );
  expect(forumCreated.status).toBe(201);
  const forum = (await forumCreated.json()) as { id: number };
  const created = await request(
    `/api/v1/nodes/${forum.id}/threads`,
    json(author.cookie, { title: "Sermo search title", body: "Opening body" }),
  );
  expect(created.status).toBe(201);
  const thread = (await created.json()) as { thread: { id: number }; post: { id: number } };
  const reply = await request(
    `/api/v1/threads/${thread.thread.id}/posts`,
    json(reader.cookie, { body: "A searchable reply" }),
  );
  expect(reply.status).toBe(201);
  const replyPost = (await reply.json()) as { id: number };
  const reactionType = ctx.sqlite
    .query<{ id: number }, []>("SELECT id FROM reaction_types LIMIT 1")
    .get();
  expect(reactionType).toBeDefined();
  const reaction = await request(`/api/v1/reactions/post/${replyPost.id}`, {
    method: "PUT",
    headers: {
      cookie: author.cookie,
      origin: "http://localhost:3000",
      "content-type": "application/json",
    },
    body: JSON.stringify({ reactionTypeId: reactionType!.id }),
  });
  expect(reaction.status).toBe(200);
  const listed = await request(`/api/v1/threads/${thread.thread.id}/posts?page=1&limit=20`);
  expect(listed.status).toBe(200);
  expect(((await listed.json()) as { items: unknown[] }).items).toHaveLength(2);
  const searched = await request("/api/v1/search?q=searchable");
  expect(searched.status).toBe(200);
  expect(((await searched.json()) as { items: unknown[] }).items.length).toBeGreaterThan(0);
  const titlesOnly = await request("/api/v1/search?q=searchable&titlesOnly=true");
  expect(titlesOnly.status).toBe(200);
  expect(((await titlesOnly.json()) as { items: unknown[] }).items).toHaveLength(0);
});

test("an API answer without its own Cache-Control is private and not stored, and explicit values stay", async () => {
  const { request } = setup();
  const me = await request("/api/v1/me");
  expect(me.headers.get("cache-control")).toBe("private, no-store");
  const missing = await request("/api/v1/nothing-here");
  expect(missing.status).toBe(404);
  expect(missing.headers.get("cache-control")).toBe("private, no-store");
  const unauthorized = await request("/api/v1/profile/avatar", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ fileId: 1 }),
  });
  expect(unauthorized.status).toBe(401);
  expect(unauthorized.headers.get("cache-control")).toBe("private, no-store");
  const session = await request("/api/auth/get-session");
  expect(session.headers.get("cache-control")).toContain("no-store");
  // Paths outside /api keep what their routes set, or nothing.
  const full = await request("/llms-full.txt");
  expect(full.headers.get("cache-control")).toBe("public, max-age=60");
  const robots = await request("/robots.txt");
  expect(robots.headers.get("cache-control")).toBeNull();
});
