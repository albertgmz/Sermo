import { type Actor, requireAuthenticated } from "../../actor";
import { type Ctx, prepared } from "../../context";
import {
  noticesCreate,
  noticesCurrent,
  noticesDelete,
  noticesDismiss,
  noticesList,
  noticesUpdate,
} from "../../contracts/notices";
import type { NOTICE_AUDIENCES } from "../../db/schema";
import { writeTx } from "../../db/tx";
import { NotFoundError, ValidationError } from "../../errors";
import { implement } from "../../operation";
import { requirePermission } from "../../permissions";
import { renderMarkdown } from "../../render";
import { iso, isoOrNull } from "../../time";

type Audience = (typeof NOTICE_AUDIENCES)[number];

interface NoticeRow {
  id: number;
  title: string;
  body_source: string;
  body_html: string;
  audience: Audience;
  audience_group_id: number | null;
  dismissible: number;
  active: number;
  starts_at: number | null;
  ends_at: number | null;
  created_at: number;
  updated_at: number;
}

type Stored = readonly [
  string,
  string,
  string,
  Audience,
  number | null,
  number,
  number,
  number | null,
  number | null,
];

export const noticesSql = {
  current:
    "SELECT * FROM notices WHERE active = 1 AND (starts_at IS NULL OR starts_at <= ?1) AND (ends_at IS NULL OR ends_at > ?1) ORDER BY id DESC",
  dismissed: "SELECT notice_id FROM notice_dismissals WHERE user_id = ?1",
  memberGroups:
    "SELECT group_id FROM users WHERE id = ?1 UNION SELECT group_id FROM user_groups WHERE user_id = ?1",
  one: "SELECT * FROM notices WHERE id = ?1",
  all: "SELECT * FROM notices ORDER BY id DESC",
  group: "SELECT id FROM groups WHERE id = ?1",
};

function query<Row, Params extends (string | number | null)[]>(
  ctx: Ctx,
  key: keyof typeof noticesSql,
) {
  return prepared(ctx, `notices.${key}`, () => ctx.sqlite.prepare<Row, Params>(noticesSql[key]));
}

/** The notices the actor is shown now, newest first, less those a member dismissed (unless asked to keep them). */
function shownTo(ctx: Ctx, actor: Actor, withDismissed = false): NoticeRow[] {
  const rows = query<NoticeRow, [number]>(ctx, "current").all(ctx.now());
  if (!rows.length) return rows;
  if (actor.kind === "guest")
    return rows.filter((row) => row.audience === "everyone" || row.audience === "guests");
  const dismissed = new Set(
    withDismissed
      ? []
      : query<{ notice_id: number }, [number]>(ctx, "dismissed")
          .all(actor.userId)
          .map((row) => row.notice_id),
  );
  const groups = new Set<number>();
  if (rows.some((row) => row.audience === "group"))
    for (const row of query<{ group_id: number }, [number]>(ctx, "memberGroups").all(actor.userId))
      groups.add(row.group_id);
  return rows.filter(
    (row) =>
      !dismissed.has(row.id) &&
      (row.audience === "everyone" ||
        row.audience === "members" ||
        (row.audience === "group" &&
          row.audience_group_id !== null &&
          groups.has(row.audience_group_id))),
  );
}

function detail(row: NoticeRow) {
  return {
    id: row.id,
    title: row.title,
    bodySource: row.body_source,
    bodyHtml: row.body_html,
    audience: row.audience,
    groupId: row.audience_group_id,
    dismissible: !!row.dismissible,
    active: !!row.active,
    startsAt: isoOrNull(row.starts_at),
    endsAt: isoOrNull(row.ends_at),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function noticeRow(ctx: Ctx, id: number): NoticeRow {
  const row = query<NoticeRow, [number]>(ctx, "one").get(id);
  if (!row) throw new NotFoundError();
  return row;
}

type Fields = {
  title: string;
  body: string;
  audience: Audience;
  groupId: number | null;
  dismissible: boolean;
  active: boolean;
  startsAt: string | null;
  endsAt: string | null;
};

/** Renders the body (before any transaction) and returns the check that builds the stored columns. */
function prepare(input: Fields): (ctx: Ctx) => Stored {
  const html = renderMarkdown(input.body);
  return (ctx) => {
    let groupId: number | null = null;
    if (input.audience === "group") {
      if (
        input.groupId === null ||
        !query<{ id: number }, [number]>(ctx, "group").get(input.groupId)
      )
        throw new ValidationError("Choose the group the notice is for.");
      groupId = input.groupId;
    }
    const startsAt = input.startsAt === null ? null : Date.parse(input.startsAt);
    const endsAt = input.endsAt === null ? null : Date.parse(input.endsAt);
    if (startsAt !== null && endsAt !== null && endsAt <= startsAt)
      throw new ValidationError("The notice must end after it starts.");
    return [
      input.title,
      input.body,
      html,
      input.audience,
      groupId,
      input.dismissible ? 1 : 0,
      input.active ? 1 : 0,
      startsAt,
      endsAt,
    ];
  };
}

const current = implement(
  noticesCurrent,
  (ctx, actor) => ({
    items: shownTo(ctx, actor).map((row) => ({
      id: row.id,
      title: row.title,
      bodyHtml: row.body_html,
      dismissible: !!row.dismissible,
    })),
  }),
  { public: "Every visitor sees the notices meant for them; nothing about a member is returned." },
);

const dismiss = implement(
  noticesDismiss,
  (ctx, actor, input) => {
    const userId = requireAuthenticated(actor).userId;
    return writeTx(ctx, () => {
      const row = shownTo(ctx, actor, true).find((entry) => entry.id === input.noticeId);
      if (!row?.dismissible) throw new NotFoundError();
      prepared(ctx, "notices.dismiss", () =>
        ctx.sqlite.prepare<unknown, [number, number, number]>(
          "INSERT INTO notice_dismissals (notice_id, user_id, dismissed_at) VALUES (?1, ?2, ?3) ON CONFLICT (user_id, notice_id) DO NOTHING",
        ),
      ).run(row.id, userId, ctx.now());
      return { ok: true as const };
    });
  },
  { public: "Any member may hide a notice shown to them; it is not found otherwise." },
);

const list = implement(noticesList, (ctx, actor) => {
  requirePermission(ctx, actor, "admin.announcements");
  return { items: query<NoticeRow, []>(ctx, "all").all().map(detail) };
});

const create = implement(noticesCreate, (ctx, actor, input) => {
  requirePermission(ctx, actor, "admin.announcements");
  const userId = requireAuthenticated(actor).userId;
  const stored = prepare(input);
  return writeTx(ctx, () => {
    const id = Number(
      prepared(ctx, "notices.insert", () =>
        ctx.sqlite.prepare<unknown, [...Stored, number, number]>(
          "INSERT INTO notices (title, body_source, body_html, audience, audience_group_id, dismissible, active, starts_at, ends_at, created_by, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11)",
        ),
      ).run(...stored(ctx), userId, ctx.now()).lastInsertRowid,
    );
    return detail(noticeRow(ctx, id));
  });
});

const update = implement(noticesUpdate, (ctx, actor, input) => {
  requirePermission(ctx, actor, "admin.announcements");
  const stored = prepare(input);
  return writeTx(ctx, () => {
    const changed = prepared(ctx, "notices.update", () =>
      ctx.sqlite.prepare<unknown, [...Stored, number, number]>(
        "UPDATE notices SET title = ?1, body_source = ?2, body_html = ?3, audience = ?4, audience_group_id = ?5, dismissible = ?6, active = ?7, starts_at = ?8, ends_at = ?9, updated_at = ?10 WHERE id = ?11",
      ),
    ).run(...stored(ctx), ctx.now(), input.noticeId).changes;
    if (!changed) throw new NotFoundError();
    return detail(noticeRow(ctx, input.noticeId));
  });
});

const remove = implement(noticesDelete, (ctx, actor, input) => {
  requirePermission(ctx, actor, "admin.announcements");
  return writeTx(ctx, () => {
    const changed = prepared(ctx, "notices.delete", () =>
      ctx.sqlite.prepare<unknown, [number]>("DELETE FROM notices WHERE id = ?1"),
    ).run(input.noticeId).changes;
    if (!changed) throw new NotFoundError();
    return { ok: true as const };
  });
});

export const operations = [current, dismiss, list, create, update, remove];
