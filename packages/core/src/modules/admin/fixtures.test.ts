import { createTestContext, userActor } from "@sermo/core/testing";
import { closeContext } from "../../context";
import { execute } from "../../operation";
import { getOperation } from "../../operations";
import { getAuth } from "../auth";
import { registerEmailJobs } from "../email";
import { registerAccountEmailJobs } from "../email/account";
import { readSiteSettings, storeSiteSettings } from "../settings";

export const PASSWORD = "Password123!";
// biome-ignore lint/suspicious/noExplicitAny: tests read the output of any operation
export type Run = (name: string, actor: object, input?: object) => Promise<any>;
export type TestCtx = ReturnType<typeof createTestContext>;

const open: TestCtx[] = [];
export function closeAll() {
  for (const ctx of open.splice(0)) closeContext(ctx);
}

/** A forum whose members can sign in: Better Auth made them, so they hold a password. */
export async function accounts(options: { mail?: boolean } = {}) {
  const ctx = createTestContext();
  open.push(ctx);
  storeSiteSettings(ctx, { ...readSiteSettings(ctx), defaultLanguage: "en" });
  const capture = options.mail
    ? (() => {
        const sent = registerEmailJobs(
          ctx,
          { driver: "capture", sender: "forum@example.test" },
          { defaults: {}, securityTypes: new Set() },
        )!;
        registerAccountEmailJobs(ctx);
        return sent;
      })()
    : null;
  const run: Run = (name, actor, input = {}) =>
    execute(ctx, getOperation(name), actor as never, input);
  const register = async (username: string, groupId?: number, email?: string) => {
    const result = await getAuth(ctx).api.signUpEmail({
      body: {
        name: username,
        username,
        email: email ?? `${username.toLowerCase().replace(/ /g, "-")}@example.test`,
        password: PASSWORD,
      },
    });
    const id = Number(result.user.id);
    if (groupId !== undefined)
      ctx.sqlite.prepare("UPDATE users SET group_id = ?1 WHERE id = ?2").run(groupId, id);
    return { id, username, groupId: groupId ?? 2, actor: userActor({ id, groupId: groupId ?? 2 }) };
  };
  const signIn = (email: string, password = PASSWORD) =>
    getAuth(ctx).api.signInEmail({ body: { email, password } });
  const sessions = (id: number) =>
    ctx.sqlite
      .prepare<{ n: number }, [number]>("SELECT count(*) AS n FROM auth_session WHERE user_id = ?1")
      .get(id)!.n;
  const logOf = (id: number) =>
    ctx.sqlite
      .prepare<{ action: string; details: string; reason: string }, [number]>(
        "SELECT action, details, reason FROM moderator_log WHERE target_type = 'user' AND target_id = ?1 ORDER BY id",
      )
      .all(id)
      .map((row) => ({ ...row, details: JSON.parse(row.details) as Record<string, unknown> }));
  return { ctx, run, register, signIn, sessions, logOf, capture };
}
