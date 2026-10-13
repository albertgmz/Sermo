import { type Ctx, prepared } from "../../context";
import { writeTx } from "../../db/tx";
import { ForbiddenError, RateLimitedError } from "../../errors";

/**
 * Wrong answers one session may give, and one member across all their sessions, in the window.
 * The session limit stops guessing through a stolen session; the member limit is larger so that
 * a stolen session cannot use up the owner's allowance and lock them out, while many sessions
 * still cannot guess without bound (opening a session takes the password).
 */
export const WRONG_PASSWORD_SESSION_LIMIT = 5;
export const WRONG_PASSWORD_MEMBER_LIMIT = 20;
export const WRONG_PASSWORD_WINDOW_MS = 15 * 60_000;

export const passwordGuessSql = {
  sessionRecent:
    "SELECT count(*) AS n FROM (SELECT 1 FROM admin_password_failures WHERE user_id = ?1 AND session_id = ?2 AND at > ?3 LIMIT ?4)",
  memberRecent:
    "SELECT count(*) AS n FROM (SELECT 1 FROM admin_password_failures WHERE user_id = ?1 AND at > ?2 LIMIT ?3)",
  prune: "DELETE FROM admin_password_failures WHERE user_id = ?1 AND at <= ?2",
  add: "INSERT INTO admin_password_failures (user_id, session_id, at) VALUES (?1, ?2, ?3) RETURNING id",
  forgive: "DELETE FROM admin_password_failures WHERE id = ?1",
};

/**
 * Takes one of the session's guesses (and one of the member's) for the window, or refuses when
 * either is used up. A guess is recorded before the password is checked, so answers sent in
 * parallel are counted as well. Pass session 0 for an in-process caller. A refusal names the
 * password `field` of the input it came from, as the other password refusals do.
 */
export function takePasswordGuess(
  ctx: Ctx,
  userId: number,
  sessionId: number,
  field = "actorPassword",
): number {
  return writeTx(ctx, () => {
    const now = ctx.now();
    const since = now - WRONG_PASSWORD_WINDOW_MS;
    ctx.sqlite.prepare(passwordGuessSql.prune).run(userId, since);
    const session = prepared(ctx, "admin.guessCountSession", () =>
      ctx.sqlite.prepare<{ n: number }, [number, number, number, number]>(
        passwordGuessSql.sessionRecent,
      ),
    ).get(userId, sessionId, since, WRONG_PASSWORD_SESSION_LIMIT)!.n;
    const member = prepared(ctx, "admin.guessCount", () =>
      ctx.sqlite.prepare<{ n: number }, [number, number, number]>(passwordGuessSql.memberRecent),
    ).get(userId, since, WRONG_PASSWORD_MEMBER_LIMIT)!.n;
    if (session >= WRONG_PASSWORD_SESSION_LIMIT || member >= WRONG_PASSWORD_MEMBER_LIMIT)
      throw new RateLimitedError("Too many wrong passwords. Try again later.", [
        { path: [field], message: "Too many wrong passwords" },
      ]);
    return ctx.sqlite
      .prepare<{ id: number }, [number, number, number]>(passwordGuessSql.add)
      .get(userId, sessionId, now)!.id;
  });
}

/** Gives a guess back after the password proved right. */
export function forgivePasswordGuess(ctx: Ctx, guess: number): void {
  writeTx(ctx, () => ctx.sqlite.prepare(passwordGuessSql.forgive).run(guess));
}

/** The parts of Better Auth's context a password check reads. */
export interface PasswordChecker {
  internalAdapter: {
    findCredentialAccount(userId: string): Promise<{ password?: string | null } | null>;
  };
  password: {
    hash(password: string): Promise<string>;
    verify(data: { hash: string; password: string }): Promise<boolean>;
  };
}

/**
 * The member's own password, checked the way Better Auth checks a sign-in and under the
 * wrong-answer limits above (`RateLimitedError` once they are used up, `ForbiddenError` for a
 * wrong answer). A right answer gives its guess back but does not clear the earlier wrong ones.
 */
export async function checkOwnPassword(
  ctx: Ctx,
  authContext: PasswordChecker,
  userId: number,
  sessionId: number,
  password: string,
  field = "actorPassword",
): Promise<void> {
  const guess = takePasswordGuess(ctx, userId, sessionId, field);
  const wrong = () =>
    new ForbiddenError("That is not your password.", [
      { path: [field], message: "Wrong password" },
    ]);
  const account = await authContext.internalAdapter.findCredentialAccount(String(userId));
  if (!account?.password) {
    // Spend the same time as a wrong password would, so the answer does not tell the two apart.
    await authContext.password.hash(password);
    throw wrong();
  }
  if (!(await authContext.password.verify({ hash: account.password, password }))) throw wrong();
  forgivePasswordGuess(ctx, guess);
}
