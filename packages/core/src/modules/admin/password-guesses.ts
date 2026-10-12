import { type Ctx, prepared } from "../../context";
import { writeTx } from "../../db/tx";
import { RateLimitedError } from "../../errors";

/** Wrong answers one member may give, and the window they count in. */
export const WRONG_PASSWORD_LIMIT = 5;
export const WRONG_PASSWORD_WINDOW_MS = 15 * 60_000;

export const passwordGuessSql = {
  recent:
    "SELECT count(*) AS n FROM (SELECT 1 FROM admin_password_failures WHERE user_id = ?1 AND at > ?2 LIMIT ?3)",
  prune: "DELETE FROM admin_password_failures WHERE user_id = ?1 AND at <= ?2",
  add: "INSERT INTO admin_password_failures (user_id, at) VALUES (?1, ?2) RETURNING id",
  forgive: "DELETE FROM admin_password_failures WHERE id = ?1",
};

/**
 * Takes one of the member's guesses for the window, or refuses when they are used up. A guess is
 * recorded before the password is checked, so answers sent in parallel are counted as well.
 */
export function takePasswordGuess(ctx: Ctx, userId: number): number {
  return writeTx(ctx, () => {
    const now = ctx.now();
    const since = now - WRONG_PASSWORD_WINDOW_MS;
    ctx.sqlite.prepare(passwordGuessSql.prune).run(userId, since);
    const used = prepared(ctx, "admin.guessCount", () =>
      ctx.sqlite.prepare<{ n: number }, [number, number, number]>(passwordGuessSql.recent),
    ).get(userId, since, WRONG_PASSWORD_LIMIT)!.n;
    if (used >= WRONG_PASSWORD_LIMIT)
      throw new RateLimitedError("Too many wrong passwords. Try again later.");
    return ctx.sqlite
      .prepare<{ id: number }, [number, number]>(passwordGuessSql.add)
      .get(userId, now)!.id;
  });
}

/** Gives a guess back after the password proved right. */
export function forgivePasswordGuess(ctx: Ctx, guess: number): void {
  writeTx(ctx, () => ctx.sqlite.prepare(passwordGuessSql.forgive).run(guess));
}
