import * as z from "zod";
import { type Actor, requireAuthenticated } from "../../actor";
import { type Ctx, prepared } from "../../context";
import { authSessionDevices, ipsContent, ipsMembers, usersIps } from "../../contracts/security";
import { ForbiddenError, ValidationError } from "../../errors";
import { type AnyOperation, implement } from "../../operation";
import { decodeCursor, encodeCursor } from "../../pagination";
import {
  can,
  memberActor,
  PRINCIPAL_COLUMNS,
  type PrincipalRow,
  requestVersions,
  requirePermission,
} from "../../permissions";
import { loadUserSummaries } from "../../shared/users";
import { iso } from "../../time";
import { sessionSql } from "../admin/sessions";
import { requireHeld, targetMember } from "../admin/shared";
import { parseAddress, parseNetwork } from "./address";
import { deviceOf } from "./device";

const PAGE_CURSOR = z.tuple([z.number().int(), z.union([z.string(), z.number().int()])]);
const NOT_FAILED = "action <> 'sign_in_failed'";

export const securitySql = {
  content:
    "SELECT user_id, ip, action, created_at, browser, os, device_type, brand, model, is_bot FROM ip_log WHERE content_type = ?1 AND content_id = ?2 ORDER BY id LIMIT 1",
  // One member's addresses: from ip_log_member_ip alone (the partial index needs NOT_FAILED).
  memberIps: `SELECT ip, n, first_at, last_at FROM (SELECT ip, count(*) AS n, min(created_at) AS first_at, max(created_at) AS last_at FROM ip_log WHERE user_id = ?1 AND ${NOT_FAILED} GROUP BY ip) WHERE (last_at, ip) < (?2, ?3) ORDER BY last_at DESC, ip DESC LIMIT ?4`,
  // The members of one address or /64: from ip_log_net_member alone.
  principals: `SELECT u.id, u.group_id, ${PRINCIPAL_COLUMNS} FROM users u WHERE u.id IN (SELECT value FROM json_each(?1))`,
  netMembers: `SELECT user_id, n, first_at, last_at FROM (SELECT user_id, count(*) AS n, min(created_at) AS first_at, max(created_at) AS last_at FROM ip_log WHERE ip_net = ?1 AND ${NOT_FAILED} GROUP BY user_id) WHERE (last_at, user_id) < (?2, ?3) ORDER BY last_at DESC, user_id DESC LIMIT ?4`,
};

interface ContentRow {
  user_id: number;
  ip: string;
  action:
    | "sign_in"
    | "sign_in_failed"
    | "register"
    | "post"
    | "thread"
    | "conversation_message"
    | "profile_post"
    | "profile_post_comment"
    | "report";
  created_at: number;
  browser: string | null;
  os: string | null;
  device_type: string | null;
  brand: string | null;
  model: string | null;
  is_bot: number;
}

/**
 * The members, among `ids`, whose addresses the actor may read: those they outrank (the rule
 * `users.adminSessions` applies to a member's sessions), or everyone for a super admin. One query.
 */
function readableMembers(ctx: Ctx, actor: Actor, ids: number[]): Set<number> {
  if (ids.length === 0) return new Set();
  const versions = requestVersions(ctx, actor);
  return new Set(
    prepared(ctx, "security.principals", () =>
      ctx.sqlite.prepare<PrincipalRow & { id: number; group_id: number }, [string]>(
        securitySql.principals,
      ),
    )
      .all(JSON.stringify(ids))
      .filter((row) =>
        can(ctx, actor, "member.viewIps", {
          target: memberActor(row.id, row.group_id, row, versions),
        }),
      )
      .map((row) => row.id),
  );
}

export const ipsContentOp = implement(ipsContent, (ctx, actor, input) => {
  requireHeld(ctx, actor, "member.viewIps");
  const found = prepared(ctx, "security.content", () =>
    ctx.sqlite.prepare<ContentRow, [string, number]>(securitySql.content),
  ).get(input.contentType, input.contentId);
  // The address of a member the actor does not outrank is not shown, as if none were logged.
  const row =
    found && readableMembers(ctx, actor, [found.user_id]).has(found.user_id) ? found : null;
  return {
    entry: row
      ? {
          userId: row.user_id,
          ip: row.ip,
          action: row.action,
          createdAt: iso(row.created_at),
          device: {
            browser: row.browser,
            os: row.os,
            deviceType: row.device_type,
            brand: row.brand,
            model: row.model,
            isBot: row.is_bot === 1,
          },
        }
      : null,
  };
});

export const usersIpsOp = implement(usersIps, (ctx, actor, input) => {
  requireAuthenticated(actor);
  requirePermission(ctx, actor, "member.viewIps", {
    target: targetMember(ctx, actor, input.userId),
  });
  const [before, after] = input.cursor
    ? decodeCursor(input.cursor, PAGE_CURSOR)
    : [Number.MAX_SAFE_INTEGER, "￿"];
  const rows = prepared(ctx, "security.memberIps", () =>
    ctx.sqlite.prepare<
      { ip: string; n: number; first_at: number; last_at: number },
      [number, number, string, number]
    >(securitySql.memberIps),
  ).all(input.userId, before, String(after), input.limit + 1);
  const page = rows.slice(0, input.limit);
  const last = page.at(-1);
  return {
    items: page.map((row) => ({
      ip: row.ip,
      network: parseAddress(row.ip)?.net ?? row.ip,
      count: row.n,
      firstSeenAt: iso(row.first_at),
      lastSeenAt: iso(row.last_at),
    })),
    nextCursor: rows.length > input.limit && last ? encodeCursor([last.last_at, last.ip]) : null,
  };
});

export const ipsMembersOp = implement(ipsMembers, (ctx, actor, input) => {
  requireHeld(ctx, actor, "member.viewIps");
  const network = parseNetwork(input.ip);
  if (!network) throw new ValidationError("Enter an IPv4 or IPv6 address.");
  const [before, after] = input.cursor
    ? decodeCursor(input.cursor, PAGE_CURSOR)
    : [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER];
  const rows = prepared(ctx, "security.netMembers", () =>
    ctx.sqlite.prepare<
      { user_id: number; n: number; first_at: number; last_at: number },
      [string, number, number, number]
    >(securitySql.netMembers),
  ).all(network, before, Number(after), input.limit + 1);
  const raw = rows.slice(0, input.limit);
  const last = raw.at(-1);
  // Members the actor does not outrank are left out, so a page can be short while more follow.
  const readable = readableMembers(
    ctx,
    actor,
    raw.map((row) => row.user_id),
  );
  const page = raw.filter((row) => readable.has(row.user_id));
  const user = loadUserSummaries(
    ctx,
    page.map((row) => row.user_id),
  );
  return {
    network,
    items: page.map((row) => ({
      user: user(row.user_id),
      count: row.n,
      firstSeenAt: iso(row.first_at),
      lastSeenAt: iso(row.last_at),
    })),
    nextCursor:
      rows.length > input.limit && last ? encodeCursor([last.last_at, last.user_id]) : null,
  };
});

export const authSessionDevicesOp = implement(
  authSessionDevices,
  (ctx, actor) => {
    const user = requireAuthenticated(actor);
    // A token cannot manage sessions, so it cannot list them either.
    if (user.kind !== "user") throw new ForbiddenError();
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
        .all(user.userId, ctx.now(), 100)
        .map((row) => ({
          sessionId: row.id,
          ipAddress: row.ip_address ? (parseAddress(row.ip_address)?.ip ?? row.ip_address) : null,
          device: deviceOf(row.user_agent),
        })),
    };
  },
  { public: "A member's own sessions: listed for the signed-in browser session, nobody else's." },
);

export const operations: AnyOperation[] = [
  ipsContentOp,
  usersIpsOp,
  ipsMembersOp,
  authSessionDevicesOp,
];
