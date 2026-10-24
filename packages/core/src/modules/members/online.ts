import type * as z from "zod";
import { type Actor, actorUserId, GUEST } from "../../actor";
import { type Ctx, prepared } from "../../context";
import {
  type ActivityPlace,
  ONLINE_PAGE_SIZE,
  type OnlineVisitor,
  onlineCounts,
  onlineList,
  usersActivity,
  type VisitorActivity,
} from "../../contracts/members";
import { implement } from "../../operation";
import {
  can,
  getNodeTree,
  permissionsOf,
  requirePermission,
  viewableNodeIds,
} from "../../permissions";
import { iso } from "../../time";
import { readGates } from "../forums/read-gates";
import { isBanned } from "./access";
import { activityShown, loadViewerCards, restrictedFor } from "./cards";
import { robotInfo } from "./online-robots";
import {
  memberVisitKey,
  pendingVisits,
  type RawPlace,
  VISIT_KEEP_MS,
  type Visit,
} from "./online-track";
import { requireSiteView, requireSiteViewForCards } from "./site-access";

type Place = z.infer<typeof ActivityPlace>;
type Activity = z.infer<typeof VisitorActivity>;
type Listed = z.infer<typeof OnlineVisitor>;

/** How far back members are listed on the online page. */
export const ONLINE_MEMBERS_WINDOW_MS = 24 * 60 * 60_000;
/** The online window: what counts as online now (XenForo's 15 minutes). */
export const ONLINE_NOW_MS = 15 * 60_000;
/** How long the list of visitors is kept: it is the same for every viewer. */
export const ONLINE_CACHE_MS = 30_000;
const MINUTE_MS = 60_000;

const toMinute = (at: number) => iso(at - (at % MINUTE_MS));

interface MemberRow {
  id: number;
  last_activity_at: number | null;
  show_online: number;
  erased_at: number | null;
  banned_until: number | null;
  banned_permanently: number;
}
interface VisitorRow {
  visitor_key: string;
  user_id: number | null;
  robot: string | null;
  place_kind: string;
  place_id: number | null;
  ip: string | null;
  seen_at: number;
}

export const onlineSql = {
  members:
    "SELECT id, last_activity_at, show_online, erased_at, banned_until, banned_permanently FROM users INDEXED BY users_last_activity WHERE last_activity_at >= ?1 AND erased_at IS NULL ORDER BY last_activity_at DESC, id DESC",
  membersById:
    "SELECT id, last_activity_at, show_online, erased_at, banned_until, banned_permanently FROM users WHERE id IN (SELECT value FROM json_each(?1))",
  visitors:
    "SELECT visitor_key, user_id, robot, place_kind, place_id, ip, seen_at FROM online_visitors WHERE seen_at >= ?1",
  visitorsByKey:
    "SELECT visitor_key, user_id, robot, place_kind, place_id, ip, seen_at FROM online_visitors WHERE visitor_key IN (SELECT value FROM json_each(?1))",
  threads:
    "SELECT id, node_id, user_id, title, state FROM threads WHERE id IN (SELECT value FROM json_each(?1))",
};

const visitOf = (row: VisitorRow): Visit => ({
  userId: row.user_id,
  robot: row.robot,
  place: { kind: row.place_kind as RawPlace["kind"], id: row.place_id },
  ip: row.ip,
  at: row.seen_at,
});

/** The stored visits of `rows` with the notes not flushed yet laid over them, newer wins. */
function withPending(ctx: Ctx, rows: VisitorRow[], keys?: Iterable<string>): Map<string, Visit> {
  const visits = new Map(rows.map((row) => [row.visitor_key, visitOf(row)]));
  const notes = pendingVisits(ctx);
  const merge = (key: string, note: Visit | undefined) => {
    if (note && note.at >= (visits.get(key)?.at ?? 0)) visits.set(key, note);
  };
  if (keys) for (const key of keys) merge(key, notes.get(key));
  else for (const [key, note] of notes) merge(key, note);
  return visits;
}

/** The newer of a member's stored activity and the one buffered by a running request. */
const seenAt = (ctx: Ctx, row: MemberRow) =>
  Math.max(row.last_activity_at ?? 0, ctx.activity.get(row.id) ?? 0);

/**
 * The places of a page of visitors as the viewer may know them, in a fixed number of reads: the
 * threads named (one query), the forum tree (cached) and the cards of the members named.
 */
function resolvePlaces(ctx: Ctx, actor: Actor, raws: RawPlace[]): (raw: RawPlace) => Place {
  const ids = (kind: RawPlace["kind"]) => [
    ...new Set(raws.flatMap((raw) => (raw.kind === kind && raw.id !== null ? [raw.id] : []))),
  ];
  const threadIds = ids("thread");
  const forumIds = ids("forum");
  const memberIds = ids("member");
  const titles = new Map<string, string>();
  if (threadIds.length > 0 || forumIds.length > 0) {
    const viewable = new Set(viewableNodeIds(ctx, actor));
    const tree = getNodeTree(ctx);
    for (const id of forumIds) {
      const node = tree.get(id);
      if (node && viewable.has(id)) titles.set(`forum:${id}`, node.title);
    }
    if (threadIds.length > 0) {
      const gates = readGates(ctx, actor);
      for (const thread of prepared(ctx, "members.onlineThreads", () =>
        ctx.sqlite.prepare<
          { id: number; node_id: number; user_id: number; title: string; state: string },
          [string]
        >(onlineSql.threads),
      ).all(JSON.stringify(threadIds)))
        if (
          thread.state === "visible" &&
          viewable.has(thread.node_id) &&
          gates.opens(thread.node_id, thread.user_id)
        )
          titles.set(`thread:${thread.id}`, thread.title);
    }
  }
  if (memberIds.length > 0)
    for (const [id, card] of loadViewerCards(ctx, actor, memberIds))
      if (!card.restricted) titles.set(`member:${id}`, card.username);
  return (raw) => {
    if (raw.id === null) return { kind: raw.kind, target: null };
    const title = titles.get(`${raw.kind}:${raw.id}`);
    return title === undefined
      ? { kind: "page", target: null }
      : { kind: raw.kind, target: { id: raw.id, title } };
  };
}

/** A visit's place while it is within the hour; null after. */
const recentPlace = (ctx: Ctx, visit: Visit | undefined) =>
  visit && visit.at >= ctx.now() - VISIT_KEEP_MS ? visit.place : null;

export const usersActivityOp = implement(
  usersActivity,
  (ctx, actor, input) => {
    requireSiteViewForCards(ctx, actor, input.userIds);
    const permitted = permissionsOf(ctx, actor);
    const self = actorUserId(actor);
    const bypass = permitted.can("profile.bypassPrivacy");
    const ids = [...new Set(input.userIds)];
    const restricted = restrictedFor(ctx, actor, ids, permitted);
    const members = prepared(ctx, "members.activityRows", () =>
      ctx.sqlite.prepare<MemberRow, [string]>(onlineSql.membersById),
    )
      .all(JSON.stringify(ids))
      .filter(
        (row) =>
          !restricted.has(row.id) && activityShown(row, self, bypass) && seenAt(ctx, row) > 0,
      );
    const keys = members.map((row) => memberVisitKey(row.id));
    const visits = withPending(
      ctx,
      prepared(ctx, "members.activityVisits", () =>
        ctx.sqlite.prepare<VisitorRow, [string]>(onlineSql.visitorsByKey),
      ).all(JSON.stringify(keys)),
      keys,
    );
    const raws = new Map(
      members.map((row) => [row.id, recentPlace(ctx, visits.get(memberVisitKey(row.id)))]),
    );
    const placeOf = resolvePlaces(
      ctx,
      actor,
      [...raws.values()].filter((raw) => raw !== null),
    );
    return {
      items: members.map((row) => {
        const raw = raws.get(row.id);
        return {
          userId: row.id,
          activity: {
            at: toMinute(seenAt(ctx, row)),
            hidden: row.show_online !== 1,
            place: raw ? placeOf(raw) : null,
          },
        };
      }),
    };
  },
  {
    public:
      "Follows each member's online status privacy and profile privacy, like users.authors; places are named only through the viewer's own permissions.",
  },
);

// The online page --------------------------------------------------------------------------------

interface ListedMember {
  id: number;
  at: number;
  hidden: boolean;
}
interface ListedGuest {
  key: string;
  visit: Visit;
}
interface Snapshot {
  at: number;
  /** Members seen in the window, banned and erased left out, most recent first. */
  members: ListedMember[];
  /** Guests and robots that viewed a page within the hour, most recent first. */
  guests: ListedGuest[];
  /** Every visit within the hour, by visitor key (members' places). */
  visits: Map<string, Visit>;
}
const snapshots = new WeakMap<Ctx, Snapshot>();

function readSnapshot(ctx: Ctx, now: number): Snapshot {
  const since = now - ONLINE_MEMBERS_WINDOW_MS;
  const seen = new Map<number, ListedMember>();
  const keep = (row: MemberRow) => {
    const at = seenAt(ctx, row);
    if (at >= since && !isBanned(row, now))
      seen.set(row.id, { id: row.id, at, hidden: row.show_online !== 1 });
  };
  for (const row of prepared(ctx, "members.onlineMembers", () =>
    ctx.sqlite.prepare<MemberRow, [number]>(onlineSql.members),
  ).all(since))
    keep(row);
  const buffered = [...ctx.activity]
    .filter(([id, at]) => at >= since && !seen.has(id))
    .map(([id]) => id);
  if (buffered.length > 0)
    for (const row of prepared(ctx, "members.activityRows", () =>
      ctx.sqlite.prepare<MemberRow, [string]>(onlineSql.membersById),
    ).all(JSON.stringify(buffered)))
      if (row.erased_at === null) keep(row);
  const visits = withPending(
    ctx,
    prepared(ctx, "members.onlineVisitors", () =>
      ctx.sqlite.prepare<VisitorRow, [number]>(onlineSql.visitors),
    ).all(now - VISIT_KEEP_MS),
  );
  const guests: ListedGuest[] = [];
  for (const [key, visit] of visits)
    if (visit.userId === null && visit.at >= now - VISIT_KEEP_MS) guests.push({ key, visit });
  return {
    at: now,
    members: [...seen.values()].sort((a, b) => b.at - a.at || b.id - a.id),
    guests: guests.sort((a, b) => b.visit.at - a.visit.at || (a.key < b.key ? -1 : 1)),
    visits,
  };
}

/** Drops the kept list of visitors, so the next read sees what was written since. */
export function forgetOnlineList(ctx: Ctx): void {
  snapshots.delete(ctx);
}

/** The visitors, the same for every viewer and kept for `ONLINE_CACHE_MS`. */
function snapshot(ctx: Ctx): Snapshot {
  const now = ctx.now();
  const kept = snapshots.get(ctx);
  if (kept && now >= kept.at && now - kept.at < ONLINE_CACHE_MS) return kept;
  const fresh = readSnapshot(ctx, now);
  snapshots.set(ctx, fresh);
  return fresh;
}

type Entry =
  | { type: "member"; at: number; member: ListedMember }
  | { type: "guest" | "robot"; at: number; guest: ListedGuest };

export const onlineListOp = implement(onlineList, (ctx, actor, input) => {
  requireSiteView(ctx, actor);
  requirePermission(ctx, actor, "member.viewList");
  const listed = snapshot(ctx);
  const self = actorUserId(actor);
  const bypass = can(ctx, actor, "profile.bypassPrivacy");
  const entries: Entry[] = [];
  if (input.type === "all" || input.type === "member")
    for (const member of listed.members)
      if (!member.hidden || member.id === self || bypass)
        entries.push({ type: "member", at: member.at, member });
  if (input.type !== "member")
    for (const guest of listed.guests) {
      const type = guest.visit.robot === null ? "guest" : "robot";
      if (input.type === "all" || input.type === type)
        entries.push({ type, at: guest.visit.at, guest });
    }
  // Both lists are in order already: a stable sort keeps members first on a tie.
  entries.sort((a, b) => b.at - a.at);
  const start = (input.page - 1) * ONLINE_PAGE_SIZE;
  const page = entries.slice(start, start + ONLINE_PAGE_SIZE);
  const memberIds = page.flatMap((entry) => (entry.type === "member" ? [entry.member.id] : []));
  const cards = memberIds.length > 0 ? loadViewerCards(ctx, actor, memberIds) : new Map();
  const rawOf = (entry: Entry): RawPlace | null => {
    if (entry.type !== "member") return entry.guest.visit.place;
    if (cards.get(entry.member.id)?.restricted !== false) return null;
    return recentPlace(ctx, listed.visits.get(memberVisitKey(entry.member.id)));
  };
  const raws = page.map(rawOf);
  const placeOf = resolvePlaces(
    ctx,
    actor,
    raws.filter((raw) => raw !== null),
  );
  const showIps = can(ctx, actor, "member.viewIps", { target: GUEST });
  const items = page.flatMap((entry, index): Listed[] => {
    const raw = raws[index];
    const activity: Activity = {
      at: toMinute(entry.at),
      hidden: entry.type === "member" && entry.member.hidden,
      place: raw ? placeOf(raw) : null,
    };
    if (entry.type === "member") {
      const card = cards.get(entry.member.id);
      return card ? [{ type: "member", card, robot: null, ip: null, activity }] : [];
    }
    const { visit } = entry.guest;
    return [
      {
        type: entry.type,
        card: null,
        robot: visit.robot === null ? null : robotInfo(visit.robot),
        ip: showIps ? visit.ip : null,
        activity,
      },
    ];
  });
  return { items, page: input.page, perPage: ONLINE_PAGE_SIZE, total: entries.length };
});

export const onlineCountsOp = implement(onlineCounts, (ctx, actor) => {
  requireSiteView(ctx, actor);
  requirePermission(ctx, actor, "member.viewList");
  const listed = snapshot(ctx);
  const since = ctx.now() - ONLINE_NOW_MS;
  let guests = 0;
  let robots = 0;
  for (const { visit } of listed.guests) {
    if (visit.at < since) break;
    if (visit.robot === null) guests++;
    else robots++;
  }
  return { guests, robots };
});
