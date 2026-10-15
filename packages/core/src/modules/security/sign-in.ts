import { type Ctx, prepared } from "../../context";
import { writeTx } from "../../db/tx";
import { logMemberIp } from "./log";

const signInSql = {
  byEmail:
    "SELECT u.id FROM auth_user a JOIN users u ON u.id = a.id WHERE a.email = ?1 AND u.erased_at IS NULL",
  byUsername: "SELECT id FROM users WHERE username_key = ?1 AND erased_at IS NULL",
};

/**
 * Notes a wrong password against the member whose account name (or address) was tried, with the
 * address and device it came from. A name that belongs to nobody leaves no row: the history is
 * the member's. An erased account leaves none either.
 */
export function logFailedSignIn(
  ctx: Ctx,
  tried: { kind: "email" | "username"; value: string },
  ip: string | null | undefined,
  userAgent: string | null | undefined,
): void {
  // Logging must never turn a refused sign-in into a server error.
  try {
    const key = tried.value.trim().toLowerCase();
    const member = prepared(ctx, `security.signIn.${tried.kind}`, () =>
      ctx.sqlite.prepare<{ id: number }, [string]>(
        tried.kind === "email" ? signInSql.byEmail : signInSql.byUsername,
      ),
    ).get(key);
    if (!member) return;
    writeTx(ctx, () => logMemberIp(ctx, member.id, ip, userAgent, "sign_in_failed"));
  } catch (error) {
    console.error("The failed sign-in could not be logged", error);
  }
}
