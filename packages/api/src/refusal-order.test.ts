import { afterEach, expect, test } from "bun:test";
import type { Ctx } from "@sermo/core";
import { closeContext, ensureAdmin, localDriver } from "@sermo/core";
import { createTestContext } from "@sermo/core/testing";
import * as z from "zod";
import { createApp } from "./app";
import { routeOperations } from "./routes";

/*
 * A caller an operation refuses whatever it sends is refused (401 for a guest, 403 for a member
 * without the permission) before its input is validated. The sweep takes every route from the
 * registry, so a new route is covered without being listed here.
 */

const contexts: Ctx[] = [];
afterEach(() => {
  for (const ctx of contexts.splice(0)) closeContext(ctx);
});

/**
 * Operations that still answer 400 to a caller they would refuse, by the caller they refuse: they
 * read their input before they decide about the caller. Some cannot decide without it (the
 * node a moderator holds a permission in, the member an administrator acts on, a password the
 * caller must confirm); the others pass the input to a service as arguments, or check inside a
 * write transaction, and could be reordered. An entry that no longer shows the 400 fails the
 * test, so this list only shrinks.
 */
const VALIDATES_FIRST: Record<string, readonly ("guest" | "member")[]> = {
  "auth.verifyPassword": ["guest"],
  "bans.lift": ["guest"],
  "conversations.listMessages": ["guest"],
  "images.setAvatar": ["guest"],
  "images.setCover": ["guest"],
  "images.setNodeCover": ["guest", "member"],
  "images.setNodeIcon": ["guest", "member"],
  "moderation.bulk": ["guest"],
  "moderation.setState": ["guest"],
  "moderatorLog.list": ["member"],
  "reports.create": ["guest"],
  "reports.setState": ["guest"],
  "restrictions.create": ["member"],
  "shop.buy": ["guest"],
  "shop.upgrade": ["guest"],
  "shop.use": ["guest"],
  "spamCleanup.start": ["member"],
  "users.adminErase": ["member"],
  "users.adminRevokeSessions": ["member"],
  "users.adminUpdateIdentity": ["member"],
  "users.adminUpdateProfile": ["member"],
  "users.deleteOwnAccount": ["member"],
  "users.ips": ["member"],
  "warnings.create": ["guest", "member"],
  "warnings.delete": ["guest"],
  "warnings.expire": ["guest"],
  "warnings.list": ["guest"],
  "wordFilters.remove": ["guest", "member"],
};

type Json = Record<string, unknown>;

function resolveRef(root: Json, node: Json): Json {
  const ref = node.$ref;
  if (typeof ref !== "string") return node;
  let target: unknown = root;
  for (const part of ref.replace(/^#\//, "").split("/")) target = (target as Json)[part];
  return resolveRef(root, target as Json);
}

/** The smallest value a JSON Schema accepts, for the shapes the contracts use. */
function sample(root: Json, schema: Json): unknown {
  const node = resolveRef(root, schema);
  if ("const" in node) return node.const;
  if (Array.isArray(node.enum)) return node.enum[0];
  const variants = (node.anyOf ?? node.oneOf) as Json[] | undefined;
  if (variants) {
    const first = variants.find((variant) => variant.type !== "null") ?? variants[0];
    return first ? sample(root, first) : null;
  }
  if (Array.isArray(node.allOf))
    return Object.assign({}, ...(node.allOf as Json[]).map((part) => sample(root, part)));
  const type = Array.isArray(node.type) ? node.type.find((t) => t !== "null") : node.type;
  switch (type) {
    case "integer":
    case "number": {
      const minimum = Math.max(
        1,
        typeof node.minimum === "number" ? node.minimum : 1,
        typeof node.exclusiveMinimum === "number" ? node.exclusiveMinimum + 1 : 1,
      );
      return minimum;
    }
    case "boolean":
      return false;
    case "array": {
      const count = typeof node.minItems === "number" ? node.minItems : 0;
      return Array.from({ length: count }, () => sample(root, (node.items ?? {}) as Json));
    }
    case "object": {
      const properties = (node.properties ?? {}) as Record<string, Json>;
      const out: Json = {};
      for (const name of (node.required ?? []) as string[])
        out[name] = sample(root, properties[name] ?? {});
      return out;
    }
    case "string": {
      if (node.format === "email") return "a@example.test";
      const length = typeof node.minLength === "number" ? Math.max(1, node.minLength) : 1;
      return "x".repeat(length);
    }
    default:
      return null;
  }
}

function queryString(values: Json): string {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(values)) {
    if (Array.isArray(value)) for (const item of value) query.append(name, String(item));
    else if (value !== null && typeof value === "object") query.set(name, JSON.stringify(value));
    else query.set(name, String(value));
  }
  return query.size ? `?${query}` : "";
}

type Variant = { name: string; query: string; body: string | undefined };

async function sweep() {
  const ctx = createTestContext();
  contexts.push(ctx);
  const app = createApp(ctx, {
    trustedProxyHeader: null,
    rateLimits: { read: 1e6, write: 1e6, search: 1e6, mcp: 1e6 },
  });
  const env = { requestIP: () => ({ address: "10.9.0.1", family: "IPv4" as const, port: 1 }) };
  const signUp = await app.request(
    "/api/auth/sign-up/email",
    {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:3000" },
      body: JSON.stringify({
        name: "plain",
        username: "plain",
        email: "plain@example.test",
        password: "Password123!",
      }),
    },
    env,
  );
  expect(signUp.status).toBe(200);
  const cookie = signUp.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");

  const send = async (
    method: string,
    path: string,
    query: string,
    body: string | undefined,
    member: boolean,
  ) => {
    const headers: Record<string, string> = {};
    if (member) headers.cookie = cookie;
    if (method !== "GET") {
      headers["content-type"] = "application/json";
      headers.origin = "http://localhost:3000";
    }
    const response = await app.request(
      `${path}${query}`,
      { method, headers, ...(method !== "GET" && body !== undefined ? { body } : {}) },
      env,
    );
    return response.status;
  };

  const findings: {
    operation: string;
    route: string;
    actor: string;
    wanted: number;
    got: number;
    sent: string;
  }[] = [];
  let compared = 0;
  const uncompared: string[] = [];
  for (const { route, op } of routeOperations) {
    const root = z.toJSONSchema(op.input, { io: "input" }) as Json;
    const properties = (root.properties ?? {}) as Record<string, Json>;
    const pathNames = [...route.path.matchAll(/\{([^}]+)\}/g)].map((match) => match[1] as string);
    const pathValues: Json = {};
    for (const name of pathNames) pathValues[name] = sample(root, properties[name] ?? {});
    const path = `/api/v1${route.path.replace(/\{([^}]+)\}/g, (_, name) => String(pathValues[name]))}`;
    const valid = sample(root, root) as Json;
    for (const name of pathNames) delete valid[name];
    const bodyless = route.method === "GET";
    const reference: Variant = {
      name: "valid",
      query: bodyless ? queryString(valid) : "",
      body: bodyless ? undefined : JSON.stringify(valid),
    };
    const garbage: Json = {};
    for (const name of Object.keys(properties)) if (!pathNames.includes(name)) garbage[name] = "!!";
    const invalid: Variant[] = [
      { name: "empty", query: "", body: bodyless ? undefined : "{}" },
      {
        name: "garbage",
        query: bodyless ? queryString(garbage) : "",
        body: bodyless ? undefined : JSON.stringify(garbage),
      },
      ...(bodyless ? [] : [{ name: "malformed", query: "", body: "{" }]),
    ];
    for (const member of [false, true]) {
      const actor = member ? "member" : "guest";
      const wanted = member ? 403 : 401;
      const base = await send(route.method, path, reference.query, reference.body, member);
      if (base !== wanted) {
        uncompared.push(`${actor} ${route.method} ${route.path} -> ${base}`);
        continue;
      }
      compared += 1;
      for (const variant of invalid) {
        const got = await send(route.method, path, variant.query, variant.body, member);
        if (got !== wanted)
          findings.push({
            operation: op.name,
            route: `${route.method} ${route.path} (${op.name})`,
            actor,
            wanted,
            got,
            sent: variant.name,
          });
      }
    }
  }
  return { findings, compared, uncompared };
}

test("a caller the operation refuses is refused before its input is validated", async () => {
  const { findings, compared } = await sweep();
  // Enough routes refuse the caller for the sweep to mean something (it grows with the API).
  expect(compared).toBeGreaterThan(300);
  const unexpected = findings.filter(
    (f) => !(VALIDATES_FIRST[f.operation] ?? []).includes(f.actor as "guest" | "member"),
  );
  expect(unexpected).toEqual([]);
  const seen = new Set(findings.map((f) => `${f.operation} ${f.actor}`));
  const stale = Object.entries(VALIDATES_FIRST).flatMap(([operation, actors]) =>
    actors
      .filter((actor) => !seen.has(`${operation} ${actor}`))
      .map((actor) => `${operation} ${actor}`),
  );
  expect(stale).toEqual([]);
}, 600_000);

async function signIn(
  app: ReturnType<typeof createApp>,
  env: object,
  email: string,
): Promise<string> {
  const response = await app.request(
    "/api/auth/sign-in/email",
    {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:3000" },
      body: JSON.stringify({ email, password: "Password123!" }),
    },
    env,
  );
  expect(response.status).toBe(200);
  return response.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
}

test("a guest and a member are refused on the IP routes whatever the query holds, an administrator is not", async () => {
  const ctx = createTestContext();
  contexts.push(ctx);
  const app = createApp(ctx, { trustedProxyHeader: null });
  const env = { requestIP: () => ({ address: "10.9.0.2", family: "IPv4" as const, port: 1 }) };
  await ensureAdmin(ctx, {
    username: "boss",
    email: "boss@example.test",
    password: "Password123!",
  });
  const member = await app.request(
    "/api/auth/sign-up/email",
    {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:3000" },
      body: JSON.stringify({
        name: "plain",
        username: "plain",
        email: "plain@example.test",
        password: "Password123!",
      }),
    },
    env,
  );
  const memberCookie = member.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  const adminCookie = await signIn(app, env, "boss@example.test");
  const get = async (path: string, cookie?: string) =>
    (await app.request(path, cookie ? { headers: { cookie } } : {}, env)).status;
  for (const query of [
    "",
    "?ip=",
    "?ip=not-an-address",
    "?limit=0",
    "?limit=abc&ip=198.51.100.7",
  ]) {
    expect(await get(`/api/v1/admin/ips/members${query}`)).toBe(401);
    expect(await get(`/api/v1/admin/ips/members${query}`, memberCookie)).toBe(403);
  }
  // Whoever may use the operation still hears what is wrong with the input.
  expect(await get("/api/v1/admin/ips/members", adminCookie)).toBe(400);
  expect(await get("/api/v1/admin/ips/members?ip=not-an-address", adminCookie)).toBe(400);
  expect(await get("/api/v1/admin/ips/members?ip=198.51.100.7", adminCookie)).toBe(200);
});

test("a guest uploading is refused before the purpose or the body is looked at", async () => {
  const ctx = createTestContext();
  contexts.push(ctx);
  const app = createApp(ctx, {
    trustedProxyHeader: null,
    storage: { driver: localDriver(".tmp-run/files"), tempDir: ".tmp-run/temp" },
  });
  const env = { requestIP: () => ({ address: "10.9.0.3", family: "IPv4" as const, port: 1 }) };
  for (const [query, headers] of [
    ["?purpose=nonsense", { "content-type": "multipart/form-data; boundary=x" }],
    ["", { "content-type": "application/json" }],
    ["", {}],
  ] as const) {
    const response = await app.request(
      `/api/v1/files${query}`,
      { method: "POST", headers, body: "x" },
      env,
    );
    expect(response.status).toBe(401);
  }
});
