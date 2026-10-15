import * as z from "zod";
import { type Actor, requireAuthenticated } from "../../actor";
import { type Ctx, prepared } from "../../context";
import {
  authNotMe,
  authSessionDevices,
  authSignInHistory,
  ipsContent,
  ipsMembers,
  privacyLogRetention,
  usersIps,
} from "../../contracts/security";
import { writeTx } from "../../db/tx";
import { ForbiddenError, NotFoundError, ValidationError } from "../../errors";
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
import { getAuth, markSessionsRevoked, revokeApiKeys } from "../auth";
import { reactablePost } from "../forums";
import { reactableProfileComment, reactableProfilePost } from "../profiles/shared";
import { parseAddress, parseNetwork } from "./address";
import { ipLogRetentionDays } from "./config";
import { deviceOf } from "./device";
import { verifyNotMe } from "./not-me-token";
import { pendingSessionActivity } from "./session";

/** The place columns as a contract Location, or null when the row has none. */
function placeOf(row: { country: string | null; region: string | null; city: string | null }) {
  return row.country || row.region || row.city
    ? { country: row.country, region: row.region, city: row.city }
    : null;
}

const PAGE_CURSOR = z.tuple([z.number().int(), z.union([z.string(), z.number().int()])]);
const NOT_FAILED = "action <> 'sign_in_failed'";

export const securitySql = {
  content:
    "SELECT user_id, ip, action, created_at, browser, os, device_type, brand, model, is_bot FROM ip_log WHERE content_type = ?1 AND content_id = ?2 ORDER BY id LIMIT 1",
  // One member's addresses: from ip_log_member_ip alone (the partial index needs NOT_FAILED).
  memberIps: `SELECT ip, n, first_at, last_at FROM (SELECT ip, count(*) AS n, min(created_at) AS first_at, max(created_at) AS last_at FROM ip_log WHERE user_id = ?1 AND ${NOT_FAILED} GROUP BY ip) WHERE (last_at, ip) < (?2, ?3) ORDER BY last_at DESC, ip DESC LIMIT ?4`,
  // A member's own sessions with the place and last use recorded for each.
  sessions:
    "SELECT s.id, s.ip_address, s.user_agent, a.last_active_at, a.country, a.region, a.city FROM auth_session s LEFT JOIN session_activity a ON a.session_id = s.id WHERE s.user_id = ?1 AND s.expires_at > ?2 ORDER BY s.id DESC LIMIT ?3",
  // A member's own sign-ins, from ip_log_member_sign_in alone in id order.
  signIns:
    "SELECT id, action, created_at, browser, os, device_type, brand, model, is_bot, country, region, city FROM ip_log WHERE user_id = ?1 AND action IN ('sign_in', 'sign_in_failed') ORDER BY id DESC LIMIT ?2",
  principals: `SELECT u.id, u.group_id, ${PRINCIPAL_COLUMNS} FROM users u WHERE u.id IN (SELECT value FROM json_each(?1))`,
  // The members of one address or /64: from ip_log_net_member alone.
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

/** Whether the actor may see the content, by the same checks the content's own reads make. */
function mayView(
  ctx: Ctx,
  actor: Actor,
  type: "post" | "profile_post" | "profile_post_comment",
  id: number,
): boolean {
  try {
    if (type === "post") reactablePost(ctx, actor, id);
    else if (type === "profile_post") reactableProfilePost(ctx, actor, id);
    else reactableProfileComment(ctx, actor, id);
    return true;
  } catch (error) {
    if (error instanceof NotFoundError) return false;
    throw error;
  }
}

export const ipsContentOp = implement(ipsContent, (ctx, actor, input) => {
  requireHeld(ctx, actor, "member.viewIps");
  const found = mayView(ctx, actor, input.contentType, input.contentId)
    ? prepared(ctx, "security.content", () =>
        ctx.sqlite.prepare<ContentRow, [string, number]>(securitySql.content),
      ).get(input.contentType, input.contentId)
    : undefined;
  // Content the actor cannot see, and the address of a member the actor does not outrank, are
  // not shown: as if none were logged.
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
      items: prepared(ctx, "security.sessions", () =>
        ctx.sqlite.prepare<
          {
            id: number;
            ip_address: string | null;
            user_agent: string | null;
            last_active_at: number | null;
            country: string | null;
            region: string | null;
            city: string | null;
          },
          [number, number, number]
        >(securitySql.sessions),
      )
        .all(user.userId, ctx.now(), 100)
        .map((row) => {
          const active = Math.max(
            row.last_active_at ?? 0,
            pendingSessionActivity(ctx, row.id) ?? 0,
          );
          return {
            sessionId: row.id,
            ipAddress: row.ip_address ? (parseAddress(row.ip_address)?.ip ?? row.ip_address) : null,
            device: deviceOf(row.user_agent),
            location: placeOf(row),
            lastActiveAt: active > 0 ? iso(active) : null,
          };
        }),
    };
  },
  { public: "A member's own sessions: listed for the signed-in browser session, nobody else's." },
);

export const authSignInHistoryOp = implement(
  authSignInHistory,
  (ctx, actor, input) => {
    const user = requireAuthenticated(actor);
    if (user.kind !== "user") throw new ForbiddenError();
    return {
      items: prepared(ctx, "security.signIns", () =>
        ctx.sqlite.prepare<
          ContentRow & {
            id: number;
            region: string | null;
            city: string | null;
            country: string | null;
          },
          [number, number]
        >(securitySql.signIns),
      )
        .all(user.userId, input.limit)
        .map((row) => ({
          id: row.id,
          at: iso(row.created_at),
          result: row.action === "sign_in" ? ("success" as const) : ("failed" as const),
          device: {
            browser: row.browser,
            os: row.os,
            deviceType: row.device_type,
            brand: row.brand,
            model: row.model,
            isBot: row.is_bot === 1,
          },
          location: placeOf(row),
        })),
    };
  },
  {
    public:
      "A member's own sign-in history: read for the signed-in browser session, nobody else's.",
  },
);

export const authNotMeOp = implement(
  authNotMe,
  async (ctx, _actor, input) => {
    const claim = await verifyNotMe(ctx, input.token);
    // A link works once: it dies when the member's sessions were cut at or after the sign-in it
    // was sent for, by itself or any other way.
    const usable = () => {
      const member = prepared(ctx, "security.notMeMember", () =>
        ctx.sqlite.prepare<
          { sessions_revoked_at: number | null; erased_at: number | null },
          [number]
        >("SELECT sessions_revoked_at, erased_at FROM users WHERE id = ?1"),
      ).get(claim.userId);
      if (
        !member ||
        member.erased_at !== null ||
        (member.sessions_revoked_at !== null && member.sessions_revoked_at >= claim.issuedAt)
      )
        throw new ValidationError("Expired or invalid link.");
    };
    const revoked = writeTx(ctx, () => {
      usable();
      return prepared(ctx, "security.notMeSessions", () =>
        ctx.sqlite.prepare<{ n: number }, [number, number]>(sessionSql.count),
      ).get(claim.userId, ctx.now())!.n;
    });
    // The order of `usersAdminRevokeSessions`. The keys go first, so a failure there leaves the
    // sessions and the link as they were and the member can try again. Then the link is spent and
    // the cut is marked in one transaction, with no await before it: from here a cached session
    // cookie is refused too. Two requests with the same link can both pass the keys; only one
    // passes the check that spends it.
    await revokeApiKeys(ctx, claim.userId);
    writeTx(ctx, () => {
      usable();
      markSessionsRevoked(ctx, claim.userId);
    });
    const authContext = await getAuth(ctx).$context;
    await authContext.internalAdapter.deleteUserSessions(String(claim.userId));
    // A session that began between the mark and the delete is cut too.
    writeTx(ctx, () => markSessionsRevoked(ctx, claim.userId));
    return { revoked };
  },
  { public: "The signed, expiring, single-use token from the member's mail authorizes this." },
);

export const privacyLogRetentionOp = implement(
  privacyLogRetention,
  (ctx) => ({ days: ipLogRetentionDays(ctx) }),
  { public: "The retention age is stated on the public privacy pages." },
);

export const operations: AnyOperation[] = [
  ipsContentOp,
  usersIpsOp,
  ipsMembersOp,
  authSessionDevicesOp,
  authSignInHistoryOp,
  authNotMeOp,
  privacyLogRetentionOp,
];

export { configureSecurity, type GeoLookup, resolveLocation } from "./config";
export { openGeoDatabase } from "./geo-maxmind";
export { proxyLocation, requestLocation, setLocationHeaders } from "./location";
export { purgeIpLog, registerSecurityJobs } from "./retention";
export { flushSessionActivity } from "./session";
