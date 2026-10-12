import * as z from "zod";
import { requireAuthenticated } from "../../actor";
import { prepared } from "../../context";
import { usersAdminLog, usersAdminRevokeSessions, usersAdminSessions } from "../../contracts/admin";
import { writeTx } from "../../db/tx";
import { NotFoundError } from "../../errors";
import { implement } from "../../operation";
import { decodeCursor, encodeCursor } from "../../pagination";
import { currentActor, requirePermission } from "../../permissions";
import { loadUserSummaries } from "../../shared/users";
import { iso } from "../../time";
import { getAuth, markSessionsRevoked } from "../auth";
import { appendModeratorLog } from "../moderation";
import { requireHeld, requireNotErased, requireTakeoverRights, targetMember } from "./shared";

const SESSION_LIMIT = 100;
export const sessionSql = {
  list: "SELECT id, created_at, expires_at, ip_address, user_agent FROM auth_session WHERE user_id = ?1 AND expires_at > ?2 ORDER BY id DESC LIMIT ?3",
  one: "SELECT token FROM auth_session WHERE id = ?1 AND user_id = ?2 AND expires_at > ?3",
  count: "SELECT count(*) AS n FROM auth_session WHERE user_id = ?1 AND expires_at > ?2",
};

export const usersAdminSessionsOp = implement(usersAdminSessions, (ctx, actor, input) => {
  requireAuthenticated(actor);
  requirePermission(ctx, actor, "admin.members", {
    target: targetMember(ctx, actor, input.userId),
  });
  return {
    items: prepared(ctx, "admin.sessions", () =>
      ctx.sqlite.prepare<
        {
          id: number;
          created_at: number;
          expires_at: number;
          ip_address: string | null;
          user_agent: string | null;
        },
        [number, number, number]
      >(sessionSql.list),
    )
      .all(input.userId, ctx.now(), SESSION_LIMIT)
      .map((row) => ({
        id: row.id,
        createdAt: iso(row.created_at),
        expiresAt: iso(row.expires_at),
        ipAddress: row.ip_address,
        userAgent: row.user_agent,
      })),
  };
});

export const usersAdminRevokeSessionsOp = implement(
  usersAdminRevokeSessions,
  async (ctx, actor, input) => {
    requireAuthenticated(actor);
    const target = targetMember(ctx, actor, input.userId);
    requirePermission(ctx, actor, "admin.members", { target });
    requireTakeoverRights(ctx, actor, target);
    requireNotErased(ctx, input.userId);
    // The log first, in the transaction that re-checks the actor; Better Auth's deletes follow.
    const plan = writeTx(ctx, () => {
      const current = currentActor(ctx, actor);
      const fresh = targetMember(ctx, current, input.userId, true);
      requirePermission(ctx, current, "admin.members", { target: fresh });
      requireTakeoverRights(ctx, current, fresh);
      requireNotErased(ctx, input.userId);
      let token: string | null = null;
      let revoked: number;
      if (input.sessionId === undefined) {
        revoked = prepared(ctx, "admin.sessionCount", () =>
          ctx.sqlite.prepare<{ n: number }, [number, number]>(sessionSql.count),
        ).get(input.userId, ctx.now())!.n;
      } else {
        const row = prepared(ctx, "admin.session", () =>
          ctx.sqlite.prepare<{ token: string }, [number, number, number]>(sessionSql.one),
        ).get(input.sessionId, input.userId, ctx.now());
        if (!row) throw new NotFoundError();
        token = row.token;
        revoked = 1;
      }
      appendModeratorLog(ctx, actor, "member.sessions.revoke", "user", input.userId, input.reason, {
        sessionId: input.sessionId ?? null,
        revoked,
      });
      // Every session at once: a cookie cache would keep the member in for minutes otherwise. One
      // session alone cannot be singled out of the member's cache without a lookup per request,
      // so that cached cookie lasts until the cache expires.
      if (token === null) markSessionsRevoked(ctx, input.userId);
      return { token, revoked };
    });
    const authContext = await getAuth(ctx).$context;
    if (plan.token !== null) await authContext.internalAdapter.deleteSession(plan.token);
    else {
      await authContext.internalAdapter.deleteUserSessions(String(input.userId));
      // A session that began between the transaction and the delete is cut too.
      writeTx(ctx, () => markSessionsRevoked(ctx, input.userId));
    }
    return { revoked: plan.revoked };
  },
);

const Cursor = z.tuple([z.number().int().positive()]);
export const logSql =
  "SELECT id, actor_id, action, reason, details, created_at FROM moderator_log WHERE target_type = 'user' AND target_id = ?1 AND id < ?2 ORDER BY id DESC LIMIT ?3";

export const usersAdminLogOp = implement(usersAdminLog, (ctx, actor, input) => {
  requireHeld(ctx, actor, "admin.members");
  const cursor = input.cursor ? decodeCursor(input.cursor, Cursor)[0] : Number.MAX_SAFE_INTEGER;
  const rows = prepared(ctx, "admin.log", () =>
    ctx.sqlite.prepare<
      {
        id: number;
        actor_id: number;
        action: string;
        reason: string;
        details: string;
        created_at: number;
      },
      [number, number, number]
    >(logSql),
  ).all(input.userId, cursor, input.limit + 1);
  const page = rows.slice(0, input.limit);
  const name = loadUserSummaries(
    ctx,
    page.map((row) => row.actor_id),
  );
  return {
    items: page.map((row) => ({
      id: row.id,
      actor: name(row.actor_id),
      action: row.action,
      reason: row.reason,
      details: JSON.parse(row.details) as Record<string, unknown>,
      createdAt: iso(row.created_at),
    })),
    nextCursor: rows.length > input.limit ? encodeCursor([page[page.length - 1]!.id]) : null,
  };
});
