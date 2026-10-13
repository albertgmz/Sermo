import { createHash } from "node:crypto";
import { type Ctx, prepared } from "../../context";
import { writeTx } from "../../db/tx";
import { RateLimitedError } from "../../errors";

/**
 * Wrong passwords one account may be tried with from one client address. Counted per account name
 * (or address) as typed and per client address, whether or not such an account exists, so a
 * stranger cannot lock the owner out from another address and the answer does not tell a known
 * account from an unknown one.
 */
export const SIGN_IN_WRONG_LIMIT = 10;
export const SIGN_IN_WINDOW_MS = 15 * 60_000;
const PRUNE_BATCH = 1000;

export const signInSql = {
  recent:
    "SELECT count(*) AS n FROM (SELECT 1 FROM sign_in_failures WHERE key = ?1 AND at > ?2 LIMIT ?3)",
  prune: "DELETE FROM sign_in_failures WHERE key = ?1 AND at <= ?2",
  add: "INSERT INTO sign_in_failures (key, at) VALUES (?1, ?2) RETURNING id",
  forgive: "DELETE FROM sign_in_failures WHERE id = ?1",
  expired:
    "DELETE FROM sign_in_failures WHERE id IN (SELECT id FROM sign_in_failures WHERE at <= ?1 LIMIT ?2)",
};

/** A digest, so the table holds neither the address nor the account name. */
function keyOf(identifier: string, ip: string): string {
  return createHash("sha256").update(`${identifier.trim().toLowerCase()}\0${ip}`).digest("hex");
}

/**
 * Takes one of the account's wrong answers for this address, or refuses when they are used up.
 * The answer is recorded before the password is checked so answers sent together are counted;
 * `forgiveSignInGuess` gives it back when the answer was not a wrong password.
 */
export function takeSignInGuess(ctx: Ctx, identifier: string, ip: string): number {
  const key = keyOf(identifier, ip);
  return writeTx(ctx, () => {
    const now = ctx.now();
    const since = now - SIGN_IN_WINDOW_MS;
    ctx.sqlite.prepare(signInSql.prune).run(key, since);
    const used = prepared(ctx, "auth.signInRecent", () =>
      ctx.sqlite.prepare<{ n: number }, [string, number, number]>(signInSql.recent),
    ).get(key, since, SIGN_IN_WRONG_LIMIT)!.n;
    if (used >= SIGN_IN_WRONG_LIMIT)
      throw new RateLimitedError("Too many requests. Please try again later.");
    return ctx.sqlite.prepare<{ id: number }, [string, number]>(signInSql.add).get(key, now)!.id;
  });
}

export function forgiveSignInGuess(ctx: Ctx, guess: number): void {
  writeTx(ctx, () => ctx.sqlite.prepare(signInSql.forgive).run(guess));
}

/** Deletes expired rows of every account, in bounded batches (the hourly cleanup). */
export function pruneSignInFailures(ctx: Ctx): void {
  for (;;) {
    const { changes } = writeTx(ctx, () =>
      ctx.sqlite.prepare(signInSql.expired).run(ctx.now() - SIGN_IN_WINDOW_MS, PRUNE_BATCH),
    );
    if (changes < PRUNE_BATCH) return;
  }
}
