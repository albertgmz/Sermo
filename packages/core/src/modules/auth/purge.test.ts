import { expect, test } from "bun:test";
import { createTestContext, expectNoTableScan, insertUser } from "@sermo/core/testing";
import type { Ctx } from "../../context";
import { CREDENTIAL_PURGE_BATCH, credentialPurgeSql, purgeExpiredCredentialsBatch } from "./index";

const BATCH = CREDENTIAL_PURGE_BATCH;
const LIVE_FROM = 1_000_000_000_000;

/** Inserts `expired` rows with an expired timestamp followed by `live` unexpired ones. */
function seed(ctx: Ctx, userId: number, expired: number, live: number): void {
  const total = expired + live;
  const exp = `CASE WHEN n <= ${expired} THEN 1 ELSE ${LIVE_FROM + 9_000_000_000_000} END`;
  const series = `WITH RECURSIVE s(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM s WHERE n < ${total})`;
  ctx.sqlite.run(
    `${series} INSERT INTO auth_session (expires_at, token, created_at, updated_at, user_id)
     SELECT ${exp}, 't' || n, 1, 1, ${userId} FROM s`,
  );
  ctx.sqlite.run(
    `${series} INSERT INTO auth_apikey (reference_id, key, expires_at, created_at, updated_at)
     SELECT '${userId}', 'k' || n, CASE WHEN n % 2 = 0 THEN NULL ELSE ${exp} END, 1, 1 FROM s`,
  );
  ctx.sqlite.run(
    `${series} INSERT INTO auth_verification (identifier, value, expires_at, created_at, updated_at)
     SELECT 'i' || n, 'v', ${exp}, 1, 1 FROM s`,
  );
}

const count = (ctx: Ctx, table: string) =>
  ctx.sqlite.query<{ n: number }, []>(`SELECT count(*) AS n FROM ${table}`).get()!.n;

test("one call deletes at most one batch per table and the job removes all and only expired rows", () => {
  const ctx = createTestContext();
  const expired = BATCH * 2 + 300;
  seed(ctx, insertUser(ctx).id, expired, 50);
  // Odd-numbered api keys follow the same expiry as the others; even ones never expire.
  const expiredKeys = ctx.sqlite
    .query<{ n: number }, []>("SELECT count(*) AS n FROM auth_apikey WHERE expires_at = 1")
    .get()!.n;

  const first = purgeExpiredCredentialsBatch(ctx);
  expect(first.sessions).toBe(BATCH);
  expect(first.verifications).toBe(BATCH);
  expect(first.apiKeys).toBeLessThanOrEqual(BATCH);
  expect(first.more).toBe(true);
  expect(count(ctx, "auth_session")).toBe(expired + 50 - BATCH);

  let calls = 1;
  let state = first;
  while (state.more) {
    state = purgeExpiredCredentialsBatch(ctx, state.after);
    calls++;
    expect(state.sessions).toBeLessThanOrEqual(BATCH);
  }
  expect(calls).toBe(3);
  expect(count(ctx, "auth_session")).toBe(50);
  expect(count(ctx, "auth_verification")).toBe(50);
  expect(count(ctx, "auth_apikey")).toBe(expired + 50 - expiredKeys);
  expect(
    ctx.sqlite
      .query<{ n: number }, []>("SELECT count(*) AS n FROM auth_session WHERE expires_at <= 1")
      .get()!.n,
  ).toBe(0);
});

test("the cursor advances per table and tables of live rows are scanned in bounded steps", () => {
  const ctx = createTestContext();
  const userId = insertUser(ctx).id;
  // Sessions: all live (more than one batch). Verifications: a few expired after the first batch.
  seed(ctx, userId, 0, BATCH + 10);
  ctx.sqlite.run("UPDATE auth_verification SET expires_at = 1 WHERE id > ?1", [BATCH + 5]);

  const first = purgeExpiredCredentialsBatch(ctx);
  expect(first).toMatchObject({ sessions: 0, verifications: 0, more: true });
  expect(first.after.sessions).toBe(BATCH);
  expect(first.after.verifications).toBe(BATCH);

  const second = purgeExpiredCredentialsBatch(ctx, first.after);
  expect(second).toMatchObject({ sessions: 0, verifications: 5, more: false });
  expect(count(ctx, "auth_session")).toBe(BATCH + 10);
  expect(count(ctx, "auth_verification")).toBe(BATCH + 5);
});

test("never deletes unexpired rows, including null api key expiry and the exact boundary", () => {
  const ctx = createTestContext();
  const userId = insertUser(ctx).id;
  const now = ctx.now();
  ctx.sqlite.run(
    "INSERT INTO auth_session (expires_at, token, created_at, updated_at, user_id) VALUES (?1, 'a', 1, 1, ?3), (?1 + 1, 'b', 1, 1, ?3), (?2, 'c', 1, 1, ?3)",
    [now, now - 1, userId],
  );
  ctx.sqlite.run(
    "INSERT INTO auth_apikey (reference_id, key, expires_at, created_at, updated_at) VALUES ('1', 'a', NULL, 1, 1), ('1', 'b', ?1, 1, 1), ('1', 'c', ?2, 1, 1)",
    [now + 1, now],
  );
  expect(purgeExpiredCredentialsBatch(ctx)).toMatchObject({ sessions: 2, apiKeys: 1 });
  expect(count(ctx, "auth_session")).toBe(1);
  expect(count(ctx, "auth_apikey")).toBe(2);
});

test("every statement of the batch avoids table scans", () => {
  const ctx = createTestContext();
  seed(ctx, insertUser(ctx).id, 10, 10);
  for (const sql of Object.values(credentialPurgeSql)) {
    expectNoTableScan(ctx, sql.scan, [0]);
    expectNoTableScan(ctx, sql.delete, [JSON.stringify([1, 2, 3]), ctx.now()]);
  }
});
