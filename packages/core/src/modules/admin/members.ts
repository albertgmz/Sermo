import * as z from "zod";
import type { Actor } from "../../actor";
import { type Ctx, prepared } from "../../context";
import type { AdminMember } from "../../contracts/admin";
import { usersAdminGet, usersAdminList } from "../../contracts/admin";
import { GROUP_IDS } from "../../db/schema";
import { NotFoundError } from "../../errors";
import { implement } from "../../operation";
import { decodeCursor, encodeCursor } from "../../pagination";
import {
  memberActor,
  PRINCIPAL_COLUMNS,
  type PrincipalRow,
  permissionsOf,
  requestVersions,
} from "../../permissions";
import { iso, isoOrNull } from "../../time";
import { scanKeyset } from "../feed/scan";
import { isBanned } from "../members/access";
import { loadMemberCards } from "../members/cards";
import { prefixSuccessor } from "../profiles/posts";
import { requireMembersAdmin } from "./shared";

type Admin = z.infer<typeof AdminMember>;

export interface AdminRow extends PrincipalRow {
  id: number;
  group_id: number;
  last_activity_at: number | null;
  username_changed_at: number | null;
  credits: number;
  email: string;
  email_verified: number;
}

export const adminSql = {
  rows: `SELECT u.id, u.group_id, u.last_activity_at, u.username_changed_at, u.credits, a.email, a.email_verified, ${PRINCIPAL_COLUMNS} FROM users u JOIN auth_user a ON a.id = u.id WHERE u.id IN (SELECT value FROM json_each(?1))`,
  /** Ids newest first below a cursor; each source serves one filter through its index. */
  all: "SELECT id FROM users WHERE id < ?1 ORDER BY id DESC LIMIT ?2",
  banned:
    "SELECT id FROM users WHERE (banned_permanently = 1 OR banned_until IS NOT NULL) AND id < ?1 ORDER BY id DESC LIMIT ?2",
  group:
    "SELECT id FROM (SELECT id FROM users WHERE group_id = ?3 AND id < ?1 UNION SELECT user_id AS id FROM user_groups WHERE group_id = ?3 AND user_id < ?1) ORDER BY id DESC LIMIT ?2",
  prefix:
    "SELECT id FROM (SELECT id FROM users WHERE username_key >= ?3 AND username_key < ?4 AND id < ?1 UNION SELECT id FROM auth_user WHERE email >= ?3 AND email < ?4 AND id < ?1) ORDER BY id DESC LIMIT ?2",
  secondary:
    "SELECT user_id FROM user_groups WHERE group_id = ?1 AND user_id IN (SELECT value FROM json_each(?2))",
};

/** `banned` while a ban is in force; `unconfirmed` while in the unconfirmed group. */
const accountState = (row: AdminRow, now: number): Admin["state"] =>
  isBanned(row, now) ? "banned" : row.group_id === GROUP_IDS.unconfirmed ? "unconfirmed" : "valid";

export function loadAdminRows(ctx: Ctx, ids: number[]): AdminRow[] {
  if (ids.length === 0) return [];
  return prepared(ctx, "admin.memberRows", () =>
    ctx.sqlite.prepare<AdminRow, [string]>(adminSql.rows),
  ).all(JSON.stringify(ids));
}

/** The administration view of members, in a fixed number of queries whatever their number. */
export function buildAdminMembers(ctx: Ctx, actor: Actor, rows: AdminRow[]): Map<number, Admin> {
  const cards = loadMemberCards(
    ctx,
    actor,
    rows.map((row) => row.id),
  );
  const grants = permissionsOf(ctx, actor);
  const versions = requestVersions(ctx, actor);
  const now = ctx.now();
  const result = new Map<number, Admin>();
  for (const row of rows) {
    const card = cards.get(row.id);
    if (!card) continue;
    const seen = Math.max(row.last_activity_at ?? 0, ctx.activity.get(row.id) ?? 0);
    result.set(row.id, {
      card,
      email: row.email,
      emailVerified: !!row.email_verified,
      state: accountState(row, now),
      createdAt: iso(row.created_at),
      lastActivityAt: seen > 0 ? iso(seen) : null,
      usernameChangedAt: isoOrNull(row.username_changed_at),
      postCount: row.post_count,
      credits: row.credits,
      canEdit: grants.can("admin.members", {
        target: memberActor(row.id, row.group_id, row, versions),
      }),
    });
  }
  return result;
}

export function loadAdminMember(ctx: Ctx, actor: Actor, userId: number): Admin {
  const member = buildAdminMembers(ctx, actor, loadAdminRows(ctx, [userId])).get(userId);
  if (!member) throw new NotFoundError();
  return member;
}

const Cursor = z.tuple([z.number().int().positive()]);

export const usersAdminListOp = implement(usersAdminList, (ctx, actor, input) => {
  requireMembersAdmin(ctx, actor);
  const now = ctx.now();
  const lower = input.prefix?.toLowerCase();
  const end = lower === undefined ? null : (prefixSuccessor(lower) ?? `${lower}\u{10ffff}`);
  // The filter that narrows the walk the most; the others are applied to what it returns.
  const source =
    lower !== undefined
      ? "prefix"
      : input.groupId !== undefined || input.state === "unconfirmed"
        ? "group"
        : input.state === "banned"
          ? "banned"
          : "all";
  const groupId = input.groupId ?? GROUP_IDS.unconfirmed;
  const fetchIds = (before: number[] | null, count: number): number[] => {
    const cursor = before ? before[0]! : Number.MAX_SAFE_INTEGER;
    const statement = prepared(ctx, `admin.list.${source}`, () =>
      ctx.sqlite.prepare<{ id: number }, (string | number)[]>(adminSql[source]),
    );
    const params: Record<typeof source, (string | number)[]> = {
      all: [cursor, count],
      banned: [cursor, count],
      group: [cursor, count, groupId],
      prefix: [cursor, count, lower ?? "", end ?? ""],
    };
    return statement.all(...params[source]).map((row) => row.id);
  };
  const scan = scanKeyset<AdminRow, number[]>({
    before: input.cursor ? decodeCursor(input.cursor, Cursor) : null,
    limit: input.limit,
    fetch: (before, count) => {
      const ids = fetchIds(before, count);
      const rows = new Map(loadAdminRows(ctx, ids).map((row) => [row.id, row]));
      return ids.flatMap((id) => rows.get(id) ?? []);
    },
    keyOf: (row) => [row.id],
    accept: (rows) => {
      const secondary =
        input.groupId !== undefined && source !== "group"
          ? new Set(
              prepared(ctx, "admin.list.secondary", () =>
                ctx.sqlite.prepare<{ user_id: number }, [number, string]>(adminSql.secondary),
              )
                .all(input.groupId, JSON.stringify(rows.map((row) => row.id)))
                .map((row) => row.user_id),
            )
          : new Set<number>();
      return new Set(
        rows.filter((row) => {
          if (
            input.groupId !== undefined &&
            source !== "group" &&
            row.group_id !== input.groupId &&
            !secondary.has(row.id)
          )
            return false;
          if (input.state === undefined) return true;
          return accountState(row, now) === input.state;
        }),
      );
    },
  });
  const members = buildAdminMembers(ctx, actor, scan.items);
  return {
    items: scan.items.flatMap((row) => members.get(row.id) ?? []),
    nextCursor: scan.next ? encodeCursor(scan.next) : null,
  };
});

export const usersAdminGetOp = implement(usersAdminGet, (ctx, actor, input) => {
  requireMembersAdmin(ctx, actor);
  return loadAdminMember(ctx, actor, input.userId);
});
