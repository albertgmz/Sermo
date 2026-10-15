import * as z from "zod";
import { type Actor, GUEST, requireAuthenticated } from "../../actor";
import { type Ctx, prepared } from "../../context";
import { signupsDecide, signupsList } from "../../contracts/signups";
import { ACCEPTANCE_KINDS } from "../../db/schema";
import { writeTx } from "../../db/tx";
import { ValidationError } from "../../errors";
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
import { appendModeratorLog, insertAuthorizedBan, requireBanLength } from "../moderation";
import { acceptanceSql } from "../pages/acceptance";
import { securitySql } from "../security";
import { eraseMember } from "./erase";
import { outcomeOf, SkipMember, tally } from "./outcomes";
import { targetMember, verifyActorPassword } from "./shared";

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
  email: string;
};

export const signupSql = {
  page: `SELECT u.id, u.group_id, u.username, u.created_at, u.signup_review, a.email, ${PRINCIPAL_COLUMNS} FROM users u JOIN auth_user a ON a.id = u.id WHERE ${AWAITING_SQL} AND u.id < ?1 ORDER BY u.id DESC LIMIT ?2`,
  // The address it signed up from: its first register row, found through the member's rows.
  registered:
    "SELECT ip, ip_net, country FROM ip_log WHERE user_id = ?1 AND action = 'register' ORDER BY id LIMIT 1",
  /** One account, if it still waits. */
  waiting: `SELECT u.id, a.email FROM users u JOIN auth_user a ON a.id = u.id WHERE u.id = ?1 AND ${AWAITING_SQL}`,
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
    ctx.sqlite.prepare<Row, [number, number]>(signupSql.page),
  ).all(before, input.limit + 1);
  const page = rows.slice(0, input.limit);
  const versions = requestVersions(ctx, actor);
  return {
    items: page.map((row) => {
      const readIps = can(ctx, actor, "member.viewIps", {
        target: memberActor(row.id, row.group_id, row, versions),
      });
      const registered = prepared(ctx, "signups.registered", () =>
        ctx.sqlite.prepare<{ ip: string; ip_net: string; country: string | null }, [number]>(
          signupSql.registered,
        ),
      ).get(row.id);
      return {
        user: { id: row.id, username: row.username },
        email: row.email,
        createdAt: iso(row.created_at),
        flagged: row.signup_review === "flagged",
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

const waiting = (ctx: Ctx, userId: number) =>
  prepared(ctx, "signups.waiting", () =>
    ctx.sqlite.prepare<{ id: number; email: string }, [number]>(signupSql.waiting),
  ).get(userId);

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
    const row = waiting(ctx, userId);
    if (!row) throw new SkipMember("This account is not waiting for approval.");
    ctx.sqlite.prepare(signupSql.clear).run(userId);
    appendModeratorLog(ctx, actor, "signup.approve", "user", userId, reason);
    publishDecided(ctx, actor, userId, "approve");
    queueAccountEmail(ctx, { kind: "signupApproved", userId, email: row.email });
  });
}

/** Rejects by banning for good: the account stays, closed, with the ban on record. */
function rejectByBan(ctx: Ctx, actor: Actor, userId: number, reason: string) {
  writeTx(ctx, () => {
    const current = currentActor(ctx, actor);
    requireApprover(ctx, current, userId);
    requirePermission(ctx, current, "member.ban", {
      target: targetMember(ctx, current, userId, true),
    });
    requireBanLength(ctx, current, null);
    const row = waiting(ctx, userId);
    if (!row) throw new SkipMember("This account is not waiting for approval.");
    ctx.sqlite.prepare(signupSql.clear).run(userId);
    // The ban is the log entry of the rejection; the member gets the rejection mail, not a ban mail.
    insertAuthorizedBan(
      ctx,
      actor,
      userId,
      reason || NO_REASON,
      null,
      { notify: false },
      "signup.reject",
      {
        mode: "ban",
      },
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

/** Rejects by erasing the account (the erasure of `users.adminErase`), then tells the member. */
async function rejectByErasing(ctx: Ctx, actor: Actor, userId: number, reason: string) {
  requirePermission(ctx, actor, "member.approveRegistrations", {
    target: targetMember(ctx, actor, userId),
  });
  const row = waiting(ctx, userId);
  if (!row) throw new SkipMember("This account is not waiting for approval.");
  // The address goes with the erasure, and so do the account mails still queued: the mail is
  // queued after it, and also when it stops part way (the account is closed by then).
  const tell = () =>
    writeTx(ctx, () =>
      queueAccountEmail(ctx, { kind: "signupRejected", userId, email: row.email, reason }),
    );
  const erased = () =>
    !!prepared(ctx, "signups.erased", () =>
      ctx.sqlite.prepare<{ id: number }, [number]>(
        "SELECT id FROM users WHERE id = ?1 AND erased_at IS NOT NULL",
      ),
    ).get(userId);
  try {
    await eraseMember(
      ctx,
      actor,
      userId,
      reason || NO_REASON,
      (current) => {
        requireApprover(ctx, current, userId);
        if (!waiting(ctx, userId))
          throw new SkipMember("This account is not waiting for approval.");
      },
      { action: "signup.reject", details: { mode: "delete" } },
    );
  } catch (error) {
    if (erased()) tell();
    throw error;
  }
  tell();
}

export const signupsDecideOp = implement(signupsDecide, async (ctx, actor, input) => {
  const { userId: actorId } = requireAuthenticated(actor);
  requirePermission(ctx, actor, "member.approveRegistrations", { target: GUEST });
  const erasing = input.decision === "reject" && input.mode === "delete";
  if (erasing) {
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
        else if (input.mode === "ban") rejectByBan(ctx, actor, userId, input.reason);
        else await rejectByErasing(ctx, actor, userId, input.reason);
      }),
    );
  }
  return tally(items);
});
