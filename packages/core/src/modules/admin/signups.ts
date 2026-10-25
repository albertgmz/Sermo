import * as z from "zod";
import { type Actor, GUEST, requireAuthenticated } from "../../actor";
import { type Ctx, prepared } from "../../context";
import { signupsDecide, signupsList } from "../../contracts/signups";
import { ACCEPTANCE_KINDS } from "../../db/schema";
import { writeTx } from "../../db/tx";
import { ConflictError, ValidationError } from "../../errors";
import { publishEvent } from "../../events";
import { implement } from "../../operation";
import { decodeCursor, encodeCursor } from "../../pagination";
import {
  AWAITING_SQL,
  can,
  currentActor,
  memberActor,
  PRINCIPAL_COLUMNS,
  type PrincipalRow,
  requestVersions,
  requirePermission,
} from "../../permissions";
import { iso } from "../../time";
import { queueAccountEmail } from "../email/account";
import { isBanned } from "../members/access";
import { inQueueSql } from "../members/signup-review";
import { welcomeNewMember } from "../members/welcome";
import { appendModeratorLog, insertAuthorizedBan, requireBanLength } from "../moderation";
import { acceptanceSql } from "../pages/acceptance";
import { securitySql } from "../security";
import { eraseAsAdministrator } from "./erase";
import { outcomeOf, SkipMember, tally } from "./outcomes";
import { requireHeld, targetMember, verifyActorPassword } from "./shared";

/*
 * The sign-up approval queue: which accounts wait (`signups.list`) and what staff decide
 * (`signups.decide`). The state itself is `users.signup_review`; see `members/signup-review.ts`.
 */

type Row = PrincipalRow & {
  id: number;
  group_id: number;
  username: string;
  created_at: number;
  signup_review: "pending" | "flagged";
  erased_at: number | null;
  email: string;
};

export const signupSql = {
  page: `SELECT u.id, u.group_id, u.username, u.created_at, u.signup_review, u.erased_at, a.email, ${PRINCIPAL_COLUMNS} FROM users u JOIN auth_user a ON a.id = u.id WHERE ${inQueueSql(3)} AND u.id < ?1 ORDER BY u.id DESC LIMIT ?2`,
  // The address it signed up from: its first register row, found through the member's rows.
  registered:
    "SELECT ip, ip_net, country FROM ip_log WHERE user_id = ?1 AND action = 'register' ORDER BY id LIMIT 1",
  /** One account, if it still waits. */
  waiting: `SELECT u.id, a.email, u.erased_at FROM users u JOIN auth_user a ON a.id = u.id WHERE u.id = ?1 AND ${AWAITING_SQL}`,
  /** One account a decision may still be made on: in the queue and not erased. */
  decidable: `SELECT u.id, a.email FROM users u JOIN auth_user a ON a.id = u.id WHERE u.id = ?1 AND u.erased_at IS NULL AND ${inQueueSql(2)}`,
  clear: "UPDATE users SET signup_review = NULL WHERE id = ?1",
  names: "SELECT id, username FROM users WHERE id IN (SELECT value FROM json_each(?1))",
};

/** The other accounts on the same address that are looked at: the newest of them. */
const SHARED_LOOKED_AT = 20;
/** What the log and the ban say when staff give no reason. */
const NO_REASON = "Registration rejected";

const Cursor = z.tuple([z.number().int().positive()]);

/** The other accounts seen on an address, for the staff who may read it. */
function sharedAddress(ctx: Ctx, actor: Actor, net: string, self: number) {
  const seen = prepared(ctx, "signups.netMembers", () =>
    ctx.sqlite.prepare<{ user_id: number }, [string, number, number, number]>(
      securitySql.netMembers,
    ),
  )
    .all(net, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, SHARED_LOOKED_AT + 1)
    .map((row) => row.user_id)
    .filter((id) => id !== self)
    .slice(0, SHARED_LOOKED_AT);
  const versions = requestVersions(ctx, actor);
  const now = ctx.now();
  const others = prepared(ctx, "signups.principals", () =>
    ctx.sqlite.prepare<PrincipalRow & { id: number; group_id: number; username: string }, [string]>(
      `SELECT u.id, u.group_id, u.username, ${PRINCIPAL_COLUMNS} FROM users u WHERE u.id IN (SELECT value FROM json_each(?1))`,
    ),
  )
    .all(JSON.stringify(seen))
    // Members the actor may not read the addresses of are left out, as `ips.members` does.
    .filter((row) =>
      can(ctx, actor, "member.viewIps", {
        target: memberActor(row.id, row.group_id, row, versions),
      }),
    );
  const order = new Map(seen.map((id, at) => [id, at]));
  others.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
  return {
    accounts: others.length,
    banned: others.filter((row) => isBanned(row, now)).length,
    members: others.slice(0, 5).map((row) => ({ id: row.id, username: row.username })),
  };
}

export const signupsListOp = implement(signupsList, (ctx, actor, input) => {
  requireAuthenticated(actor);
  requirePermission(ctx, actor, "member.approveRegistrations", { target: GUEST });
  const [before] = input.cursor ? decodeCursor(input.cursor, Cursor) : [Number.MAX_SAFE_INTEGER];
  const rows = prepared(ctx, "signups.page", () =>
    ctx.sqlite.prepare<Row, [number, number, number]>(signupSql.page),
  ).all(before, input.limit + 1, ctx.now());
  const page = rows.slice(0, input.limit);
  const versions = requestVersions(ctx, actor);
  return {
    items: page.map((row) => {
      const target = memberActor(row.id, row.group_id, row, versions);
      const readIps = can(ctx, actor, "member.viewIps", { target });
      // The address is a member's private detail: staff who manage members see it, others a mask.
      const emailHidden = !can(ctx, actor, "admin.members", { target });
      const registered = prepared(ctx, "signups.registered", () =>
        ctx.sqlite.prepare<{ ip: string; ip_net: string; country: string | null }, [number]>(
          signupSql.registered,
        ),
      ).get(row.id);
      return {
        user: { id: row.id, username: row.username },
        email: emailHidden ? maskEmail(row.email) : row.email,
        emailHidden,
        createdAt: iso(row.created_at),
        flagged: row.signup_review === "flagged",
        erasureStopped: row.erased_at !== null,
        country: registered?.country ?? null,
        ip: readIps ? (registered?.ip ?? null) : null,
        sharedAddress:
          readIps && registered ? sharedAddress(ctx, actor, registered.ip_net, row.id) : null,
        acceptances: ACCEPTANCE_KINDS.flatMap((kind) =>
          prepared(ctx, "signups.acceptance", () =>
            ctx.sqlite.prepare<
              { kind: (typeof ACCEPTANCE_KINDS)[number]; version: number; accepted_at: number },
              [number, string, number]
            >(acceptanceSql.memberKind),
          )
            .all(row.id, kind, 1)
            .map((accepted) => ({
              kind: accepted.kind,
              version: accepted.version,
              acceptedAt: iso(accepted.accepted_at),
            })),
        ),
      };
    }),
    nextCursor: rows.length > input.limit ? encodeCursor([page.at(-1)!.id]) : null,
  };
});

/** `j***@example.com`: the first letter and the domain. */
export const maskEmail = (email: string): string => {
  const at = email.lastIndexOf("@");
  return at < 1 ? "***" : `${email[0]}***${email.slice(at)}`;
};

/** The account if it still holds its place in the queue, an erasure that stopped part way included. */
const waiting = (ctx: Ctx, userId: number) =>
  prepared(ctx, "signups.waiting", () =>
    ctx.sqlite.prepare<{ id: number; email: string; erased_at: number | null }, [number]>(
      signupSql.waiting,
    ),
  ).get(userId);

/**
 * The account a decision may still be made on. Anyone else is a conflict: it was decided on
 * already (a second decider, a double submit), is held back by a ban, or its erasure stopped part
 * way, which only erasing again finishes.
 */
function decidable(ctx: Ctx, userId: number): { id: number; email: string } {
  const row = prepared(ctx, "signups.decidable", () =>
    ctx.sqlite.prepare<{ id: number; email: string }, [number, number]>(signupSql.decidable),
  ).get(userId, ctx.now());
  if (row) return row;
  if (waiting(ctx, userId)?.erased_at != null)
    throw new ConflictError("Its erasure stopped part way: reject it by erasing to finish it.");
  throw new ConflictError("This account is not waiting for approval.");
}

/** The permission over the account, on the actor as the database has it now (inside a transaction). */
function requireApprover(ctx: Ctx, current: Actor, userId: number) {
  requirePermission(ctx, current, "member.approveRegistrations", {
    target: targetMember(ctx, current, userId, true),
  });
}

function approve(ctx: Ctx, actor: Actor, userId: number, reason: string) {
  writeTx(ctx, () => {
    const current = currentActor(ctx, actor);
    requireApprover(ctx, current, userId);
    const row = decidable(ctx, userId);
    ctx.sqlite.prepare(signupSql.clear).run(userId);
    appendModeratorLog(ctx, actor, "signup.approve", "user", userId, reason);
    publishDecided(ctx, actor, userId, "approve");
    queueAccountEmail(ctx, { kind: "signupApproved", userId, email: row.email });
    welcomeNewMember(ctx, userId);
  });
}

/**
 * Rejects by banning, as the actor's own ban: member.ban over the account, the length bounded by
 * member.banMaxDays. A ban for good closes the account; a ban for a time keeps it held (out of the
 * queue while the ban runs) so it cannot become a member when the ban ends.
 */
function rejectByBan(
  ctx: Ctx,
  actor: Actor,
  userId: number,
  reason: string,
  expiresAt: number | null,
  days: number | null,
) {
  writeTx(ctx, () => {
    const current = currentActor(ctx, actor);
    requireApprover(ctx, current, userId);
    requirePermission(ctx, current, "member.ban", {
      target: targetMember(ctx, current, userId, true),
    });
    requireBanLength(ctx, current, expiresAt);
    const row = decidable(ctx, userId);
    if (expiresAt === null) ctx.sqlite.prepare(signupSql.clear).run(userId);
    // The ban is the log entry of the rejection; the member gets the rejection mail, not a ban mail.
    insertAuthorizedBan(
      ctx,
      actor,
      userId,
      reason || NO_REASON,
      expiresAt,
      { notify: false },
      "signup.reject",
      { mode: "ban", days },
    );
    publishDecided(ctx, actor, userId, "reject");
    queueAccountEmail(ctx, { kind: "signupRejected", userId, email: row.email, reason });
  });
}

function publishDecided(ctx: Ctx, actor: Actor, userId: number, decision: "approve" | "reject") {
  publishEvent(ctx, {
    type: "member.signup_decided",
    targetType: "user",
    targetId: userId,
    payload: { decision, moderatorId: requireAuthenticated(actor).userId },
  });
}

/**
 * Rejects by erasing the account: the erasure of `users.adminErase` (admin.members over it). The
 * rejection mail is queued by the transaction that marks the account erased, while the address is
 * still the member's (the erasure spares that job), and only by it, under a key of its own: an
 * erasure that stopped part way leaves the account in the queue, and deciding again finishes it
 * without a second mail. A second decider meanwhile gets a conflict.
 */
async function rejectByErasing(ctx: Ctx, actor: Actor, userId: number, reason: string) {
  requireApprover(ctx, actor, userId);
  if (!waiting(ctx, userId)) throw new ConflictError("This account is not waiting for approval.");
  await eraseAsAdministrator(ctx, actor, userId, reason || NO_REASON, {
    entry: {
      action: "signup.reject",
      details: { mode: "delete" },
      onMark: (email) =>
        queueAccountEmail(
          ctx,
          { kind: "signupRejected", userId, email, reason },
          `signup-rejected:${userId}`,
        ),
    },
    also: (current) => {
      requireApprover(ctx, current, userId);
      if (!waiting(ctx, userId))
        throw new ConflictError("This account is not waiting for approval.");
    },
  });
}

export const signupsDecideOp = implement(signupsDecide, async (ctx, actor, input) => {
  const { userId: actorId } = requireAuthenticated(actor);
  requirePermission(ctx, actor, "member.approveRegistrations", { target: GUEST });
  const erasing = input.decision === "reject" && input.mode === "delete";
  const banning = input.decision === "reject" && input.mode === "ban";
  const expiresAt = input.banDays === null ? null : ctx.now() + input.banDays * 86_400_000;
  // Refused once, up front, rather than once for every account.
  if (banning) {
    requireHeld(ctx, actor, "member.ban");
    requireBanLength(ctx, actor, expiresAt);
  }
  if (erasing) {
    requireHeld(ctx, actor, "admin.members");
    if (input.actorPassword === undefined)
      throw new ValidationError("The acting administrator's password is required.", [
        { path: ["actorPassword"], message: "Required" },
      ]);
    await verifyActorPassword(ctx, actor, input.actorPassword);
  }
  const ids = [...new Set(input.userIds)];
  const names = new Map(
    prepared(ctx, "signups.names", () =>
      ctx.sqlite.prepare<{ id: number; username: string }, [string]>(signupSql.names),
    )
      .all(JSON.stringify(ids))
      .map((row) => [row.id, row.username]),
  );
  const items = [];
  for (const userId of ids) {
    items.push(
      await outcomeOf(userId, names.get(userId) ?? String(userId), async () => {
        if (userId === actorId) throw new SkipMember("You cannot decide on your own account.");
        if (input.decision === "approve") approve(ctx, actor, userId, input.reason);
        else if (input.mode === "ban")
          rejectByBan(ctx, actor, userId, input.reason, expiresAt, input.banDays);
        else await rejectByErasing(ctx, actor, userId, input.reason);
      }),
    );
  }
  return tally(items);
});
