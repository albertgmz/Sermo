import * as z from "zod";
import { type Actor, actorUserId } from "../../actor";
import { type Ctx, prepared } from "../../context";
import type { AdminMember } from "../../contracts/admin";
import { usersAdminGet, usersAdminList } from "../../contracts/admin";
import { GROUP_IDS } from "../../db/schema";
import { NotFoundError } from "../../errors";
import { implement } from "../../operation";
import { decodeCursor, encodeCursor } from "../../pagination";
import {
  AWAITING_SQL,
  isSuperAdmin,
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
import { requireHeld } from "./shared";

type Admin = z.infer<typeof AdminMember>;

export interface AdminRow extends PrincipalRow {
  id: number;
  group_id: number;
  last_activity_at: number | null;
  username_key: string;
  erased_at: number | null;
  username_changed_at: number | null;
  credits: number;
  email: string;
  email_verified: number;
}

export const adminSql = {
  rows: `SELECT u.id, u.group_id, u.username_key, u.erased_at, u.last_activity_at, u.username_changed_at, u.credits, a.email, a.email_verified, ${PRINCIPAL_COLUMNS} FROM users u JOIN auth_user a ON a.id = u.id WHERE u.id IN (SELECT value FROM json_each(?1))`,
  /** Ids newest first below a cursor; each source serves one filter through its index. */
  all: "SELECT id FROM users WHERE id < ?1 ORDER BY id DESC LIMIT ?2",
  banned:
    "SELECT id FROM users WHERE (banned_permanently = 1 OR banned_until IS NOT NULL) AND id < ?1 ORDER BY id DESC LIMIT ?2",
  erased: "SELECT id FROM users WHERE erased_at IS NOT NULL AND id < ?1 ORDER BY id DESC LIMIT ?2",
  awaiting: `SELECT u.id FROM users u WHERE ${AWAITING_SQL} AND u.id < ?1 ORDER BY u.id DESC LIMIT ?2`,
  /** A group's members: those with it as primary group, and those who hold it by hand. */
  groupPrimary: "SELECT id FROM users WHERE group_id = ?3 AND id < ?1 ORDER BY id DESC LIMIT ?2",
  groupSecondary:
    "SELECT user_id AS id FROM user_groups WHERE group_id = ?3 AND user_id < ?1 ORDER BY user_id DESC LIMIT ?2",
  /** The prefix, by username key then by email, each after the key the last page ended at. */
  prefixName:
    "SELECT id, username_key AS at FROM users WHERE username_key > ?1 AND username_key >= ?3 AND username_key < ?4 ORDER BY username_key LIMIT ?2",
  prefixEmail:
    "SELECT id, email AS at FROM auth_user WHERE email > ?1 AND email >= ?3 AND email < ?4 ORDER BY email LIMIT ?2",
  secondary:
    "SELECT user_id FROM user_groups WHERE group_id = ?1 AND user_id IN (SELECT value FROM json_each(?2))",
};

/** `erased`, then `banned` while a ban is in force, then `unconfirmed`, `awaiting`, else `valid`. */
const accountState = (row: AdminRow, now: number): Admin["state"] =>
  row.erased_at !== null
    ? "erased"
    : isBanned(row, now)
      ? "banned"
      : row.group_id === GROUP_IDS.unconfirmed
        ? "unconfirmed"
        : row.awaiting_approval
          ? "awaiting"
          : "valid";

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
  const viewerIsSuperAdmin = isSuperAdmin(ctx, actor);
  const result = new Map<number, Admin>();
  for (const row of rows) {
    const card = cards.get(row.id);
    if (!card) continue;
    const seen = Math.max(row.last_activity_at ?? 0, ctx.activity.get(row.id) ?? 0);
    const editable = grants.can("admin.members", {
      target: memberActor(row.id, row.group_id, row, versions),
    });
    result.set(row.id, {
      card,
      // The address of a member who ranks at or above the actor is not shown to them.
      email: editable || row.id === actorUserId(actor) ? row.email : null,
      emailVerified: !!row.email_verified,
      state: accountState(row, now),
      erasedAt: isoOrNull(row.erased_at),
      createdAt: iso(row.created_at),
      lastActivityAt: seen > 0 ? iso(seen) : null,
      usernameChangedAt: isoOrNull(row.username_changed_at),
      postCount: row.post_count,
      credits: row.credits,
      canEdit: editable,
      isSuperAdmin: !!row.is_super_admin,
      canSetSuperAdmin: viewerIsSuperAdmin && editable && row.erased_at === null,
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
/** A prefix page ends at a username key (1) or, once those are done, at an email (2). */
const PrefixCursor = z.tuple([z.union([z.literal(1), z.literal(2)]), z.string()]);

type Key = (number | string)[];
type Item = AdminRow & { at: Key };
type Found = { id: number; at: Key };

/**
 * The ids below `before` that two or more sources share out (a group's primary members and the
 * members who hold it by hand), newest first, each id once. Each source is read in batches of
 * `count` through its own index, so a page reads at most about twice what it returns.
 */
function mergeNewestFirst(
  sources: ((before: number, count: number) => number[])[],
  before: number,
  count: number,
): number[] {
  const lanes = sources.map((fetch) => ({
    fetch,
    buffer: [] as number[],
    cursor: before,
    done: false,
  }));
  const head = (lane: (typeof lanes)[number]) => {
    if (lane.buffer.length === 0 && !lane.done) {
      lane.buffer = lane.fetch(lane.cursor, count);
      if (lane.buffer.length < count) lane.done = true;
      if (lane.buffer.length > 0) lane.cursor = lane.buffer[lane.buffer.length - 1]!;
    }
    return lane.buffer[0];
  };
  const out: number[] = [];
  while (out.length < count) {
    let best: (typeof lanes)[number] | null = null;
    let bestId = -1;
    for (const lane of lanes) {
      const id = head(lane);
      if (id !== undefined && id > bestId) {
        best = lane;
        bestId = id;
      }
    }
    if (!best) break;
    best.buffer.shift();
    if (out[out.length - 1] !== bestId) out.push(bestId);
  }
  return out;
}

export const usersAdminListOp = implement(usersAdminList, (ctx, actor, input) => {
  requireHeld(ctx, actor, "admin.members");
  const now = ctx.now();
  const lower = input.prefix?.toLowerCase();
  const end = lower === undefined ? "" : (prefixSuccessor(lower) ?? `${lower}\u{10ffff}`);
  // The filter that narrows the walk the most; the others are applied to what it returns.
  const source =
    lower !== undefined
      ? "prefix"
      : input.groupId !== undefined || input.state === "unconfirmed"
        ? "group"
        : input.state === "banned"
          ? "banned"
          : input.state === "erased"
            ? "erased"
            : input.state === "awaiting"
              ? "awaiting"
              : "all";
  const groupId = input.groupId ?? GROUP_IDS.unconfirmed;
  const ids = (name: keyof typeof adminSql, params: (string | number)[]) =>
    prepared(ctx, `admin.list.${name}`, () =>
      ctx.sqlite.prepare<Found, (string | number)[]>(adminSql[name]),
    ).all(...params);
  const newestFirst =
    (name: keyof typeof adminSql, extra: number[]) => (before: number, count: number) =>
      ids(name, [before, count, ...extra]).map((row) => row.id);
  const fetchIds = (before: Key | null, count: number): Found[] => {
    if (source === "prefix") {
      const found: Found[] = [];
      const phase = before?.[0] === 2 ? 2 : 1;
      if (phase === 1)
        for (const row of ids("prefixName", [before ? String(before[1]) : "", count, lower!, end]))
          found.push({ id: row.id, at: [1, String(row.at)] });
      if (found.length < count)
        for (const row of ids("prefixEmail", [
          phase === 2 ? String(before![1]) : "",
          count - found.length,
          lower!,
          end,
        ]))
          found.push({ id: row.id, at: [2, String(row.at)] });
      return found;
    }
    const cursor = before ? Number(before[0]) : Number.MAX_SAFE_INTEGER;
    const list =
      source === "group"
        ? mergeNewestFirst(
            [
              newestFirst("groupPrimary", [groupId]),
              // Unconfirmed is only ever a primary group.
              ...(input.groupId === undefined ? [] : [newestFirst("groupSecondary", [groupId])]),
            ],
            cursor,
            count,
          )
        : ids(source, [cursor, count]).map((row) => row.id);
    return list.map((id) => ({ id, at: [id] }));
  };
  const grants = permissionsOf(ctx, actor);
  const versions = requestVersions(ctx, actor);
  const scan = scanKeyset<Item, Key>({
    before: input.cursor
      ? (decodeCursor(input.cursor, source === "prefix" ? PrefixCursor : Cursor) as Key)
      : null,
    limit: input.limit,
    fetch: (before, count) => {
      const found = fetchIds(before, count);
      const rows = new Map(
        loadAdminRows(
          ctx,
          found.map((entry) => entry.id),
        ).map((row) => [row.id, row]),
      );
      return found.flatMap((entry) => {
        const row = rows.get(entry.id);
        return row ? [{ ...row, at: entry.at }] : [];
      });
    },
    keyOf: (item) => item.at,
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
          // Found by address alone: only for a member the actor outranks, or the search would
          // confirm the characters of a higher-ranked member's address one by one.
          if (
            source === "prefix" &&
            row.at[0] === 2 &&
            row.id !== actorUserId(actor) &&
            !grants.can("admin.members", {
              target: memberActor(row.id, row.group_id, row, versions),
            })
          )
            return false;
          // Listed already among the usernames.
          if (
            source === "prefix" &&
            row.at[0] === 2 &&
            row.username_key >= lower! &&
            row.username_key < end
          )
            return false;
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
  requireHeld(ctx, actor, "admin.members");
  return loadAdminMember(ctx, actor, input.userId);
});
