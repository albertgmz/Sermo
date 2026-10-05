import { createApp, routes } from "@sermo/api";
import { type Actor, type Ctx, GUEST, getAuth } from "@sermo/core";
import type { Rng } from "./rng";
import type { SeedMeta } from "./seed";

/** Budgets from the product requirements, in milliseconds, measured per request server-side. */
export const BUDGETS = { readP95: 20, writeP95: 50, max: 200 } as const;

export interface BenchEnv {
  ctx: Ctx;
  meta: SeedMeta;
  rng: Rng;
  actors: {
    guest: Actor;
    /** Actor for any seeded user id (group looked up from the database). */
    user(userId: number): Actor;
    /** An active member, chosen by index (wraps around meta.memberIds). */
    member(i: number): Actor;
    moderator(i: number): Actor;
    admin: Actor;
  };
  /**
   * Performs one HTTP request through the full app (secure headers, client IP, actor resolution,
   * rate limiting, CSRF, routing, input coercion, the operation, JSON serialization). Signed-in
   * actors authenticate with a Better Auth API key. Throws on a non-2xx response.
   */
  call(operation: string, actor: Actor, input: unknown): Promise<unknown>;
  /** Sends a raw request through the same app (for cookie-authenticated scenarios). */
  request(path: string, init?: RequestInit): Promise<Response>;
}

export interface Scenario {
  /** Shown in the report; use the operation name, plus a qualifier if needed. */
  name: string;
  kind: "read" | "write";
  /** Measured iterations (default 200 for reads, 100 for writes). */
  iterations?: number;
  /**
   * Reported but never failed against the budgets, with the reason shown in the report. Only for
   * costs the product requirements exempt: password hashing.
   */
  budgetExempt?: "password hashing";
  setup?(env: BenchEnv): void | Promise<void>;
  /** One request. `i` is the iteration number, useful to vary inputs deterministically. */
  run(env: BenchEnv, i: number): unknown | Promise<unknown>;
}

const BASE = "http://localhost:3000";
/** Limits are enforced as in production but set out of reach, so the benchmark measures cost. */
const UNREACHABLE = 1_000_000_000;

export async function createEnv(ctx: Ctx, meta: SeedMeta, rng: Rng): Promise<BenchEnv> {
  const app = createApp(ctx, {
    trustedProxyHeader: null,
    rateLimits: { read: UNREACHABLE, write: UNREACHABLE, search: UNREACHABLE, mcp: UNREACHABLE },
  });
  const connInfo = {
    requestIP: () => ({ address: "127.0.0.1", family: "IPv4" as const, port: 1 }),
  };
  const request = async (path: string, init?: RequestInit) =>
    app.request(`${BASE}${path}`, init, connInfo);

  const groupOf = ctx.sqlite.prepare<{ group_id: number }, [number]>(
    "SELECT group_id FROM users WHERE id = ?1",
  );
  const user = (userId: number): Actor => {
    const row = groupOf.get(userId);
    if (!row) throw new Error(`No seeded user ${userId}`);
    return { kind: "user", userId, groupId: row.group_id, sessionId: 0 };
  };

  // One API key per user, created server-side (no password hashing) before measuring.
  const keys = new Map<number, string>();
  const keyFor = async (userId: number) => {
    let key = keys.get(userId);
    if (!key) {
      const created = await getAuth(ctx).api.createApiKey({
        body: { userId: String(userId), name: "benchmark" },
      });
      key = created.key;
      keys.set(userId, key);
    }
    return key;
  };
  for (const id of [meta.adminId, ...meta.moderatorIds, ...meta.memberIds]) await keyFor(id);

  const routeByOperation = new Map(routes.map((r) => [r.operation, r]));

  return {
    ctx,
    meta,
    rng,
    actors: {
      guest: GUEST,
      user,
      member: (i) => user(meta.memberIds[i % meta.memberIds.length]!),
      moderator: (i) => user(meta.moderatorIds[i % meta.moderatorIds.length]!),
      admin: user(meta.adminId),
    },
    request,
    async call(operation, actor, input) {
      const route = routeByOperation.get(operation);
      if (!route) throw new Error(`No route for ${operation}`);
      const fields = { ...((input ?? {}) as Record<string, unknown>) };
      const path = route.path.replace(/\{(\w+)\}/g, (_, name: string) => {
        const value = fields[name];
        delete fields[name];
        return encodeURIComponent(String(value));
      });
      const headers = new Headers();
      if (actor.kind !== "guest")
        headers.set("authorization", `Bearer ${await keyFor(actor.userId)}`);
      let url = `/api/v1${path}`;
      let body: string | undefined;
      if (route.method === "GET" || route.method === "DELETE") {
        const query = new URLSearchParams();
        for (const [name, value] of Object.entries(fields)) {
          if (value === undefined) continue;
          for (const item of Array.isArray(value) ? value : [value])
            query.append(name, String(item));
        }
        if (query.size > 0) url += `?${query}`;
      } else {
        headers.set("content-type", "application/json");
        body = JSON.stringify(fields);
      }
      const response = await request(url, { method: route.method, headers, body });
      const text = await response.text();
      if (!response.ok) throw new Error(`${operation} -> ${response.status} ${text}`);
      return text;
    },
  };
}
