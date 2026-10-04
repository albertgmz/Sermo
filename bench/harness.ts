import { type Actor, type Ctx, execute, GUEST, getOperation } from "@sermo/core";
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
  /** Performs one request: input parsing, the operation, and JSON serialization of the result. */
  call(operation: string, actor: Actor, input: unknown): Promise<unknown>;
}

export interface Scenario {
  /** Shown in the report; use the operation name, plus a qualifier if needed. */
  name: string;
  kind: "read" | "write";
  /** Measured iterations (default 200 for reads, 100 for writes). */
  iterations?: number;
  setup?(env: BenchEnv): void | Promise<void>;
  /** One request. `i` is the iteration number, useful to vary inputs deterministically. */
  run(env: BenchEnv, i: number): unknown | Promise<unknown>;
}

export function createEnv(ctx: Ctx, meta: SeedMeta, rng: Rng): BenchEnv {
  const groupOf = ctx.sqlite.prepare<{ group_id: number }, [number]>(
    "SELECT group_id FROM users WHERE id = ?1",
  );
  const user = (userId: number): Actor => {
    const row = groupOf.get(userId);
    if (!row) throw new Error(`No seeded user ${userId}`);
    return { kind: "user", userId, groupId: row.group_id, sessionId: 0 };
  };
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
    async call(operation, actor, input) {
      const result = await execute(ctx, getOperation(operation), actor, input);
      return JSON.stringify(result);
    },
  };
}
