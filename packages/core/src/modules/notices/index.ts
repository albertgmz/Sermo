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
import { writeTx } from "../../db/tx";
import { NotFoundError, ValidationError } from "../../errors";
import { implement } from "../../operation";
import { requirePermission } from "../../permissions";
import { renderMarkdown } from "../../render";
import { actorFacts, assertRule, evaluate, parseRule, type Rule } from "../../shared/criteria";
import { iso, isoOrNull } from "../../time";

interface NoticeRow {
  id: number;
  title: string;
  body_source: string;
  body_html: string;
  rule: string;
  dismissible: number;
  active: number;
  starts_at: number | null;
  ends_at: number | null;
  created_at: number;
  updated_at: number;
}

type ShownRow = Pick<NoticeRow, "id" | "title" | "body_html" | "rule" | "dismissible">;

type Stored = readonly [
  string,
  string,
  string,
  string,
  number,
  number,
  number | null,
  number | null,
];

export const noticesSql = {
  current:
    "SELECT id, title, body_html, rule, dismissible FROM notices WHERE active = 1 AND (starts_at IS NULL OR starts_at <= ?1) AND (ends_at IS NULL OR ends_at > ?1) ORDER BY id DESC",
  dismissed: "SELECT notice_id FROM notice_dismissals WHERE user_id = ?1",
  one: "SELECT * FROM notices WHERE id = ?1",
  all: "SELECT * FROM notices ORDER BY id DESC",
};

function query<Row, Params extends (string | number | null)[]>(
  ctx: Ctx,
  key: keyof typeof noticesSql,
) {
  return prepared(ctx, `notices.${key}`, () => ctx.sqlite.prepare<Row, Params>(noticesSql[key]));
}

/** The notices the actor is shown now, newest first, less those a member dismissed (unless asked to keep them). */
function shownTo(ctx: Ctx, actor: Actor, withDismissed = false): ShownRow[] {
  const rows = query<ShownRow, [number]>(ctx, "current").all(ctx.now());
  if (!rows.length) return rows;
  const rules = new Map(rows.map((row) => [row.id, parseRule(row.rule)]));
  const facts = actorFacts(ctx, actor, rules.values());
  const dismissed = new Set(
    withDismissed || actor.kind === "guest"
      ? []
      : query<{ notice_id: number }, [number]>(ctx, "dismissed")
          .all(actor.userId)
          .map((row) => row.notice_id),
  );
  return rows.filter((row) => !dismissed.has(row.id) && evaluate(rules.get(row.id)!, facts));
}

function detail(row: NoticeRow) {
  return {
    id: row.id,
    title: row.title,
    bodySource: row.body_source,
    bodyHtml: row.body_html,
    rule: parseRule(row.rule),
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
  rule: Rule;
  dismissible: boolean;
  active: boolean;
  startsAt: string | null;
  endsAt: string | null;
};

/** Renders the body (before any transaction) and returns the check that builds the stored columns. */
function prepare(input: Fields): (ctx: Ctx) => Stored {
  const html = renderMarkdown(input.body);
  return (ctx) => {
    assertRule(ctx, input.rule, "cheap");
    const startsAt = input.startsAt === null ? null : Date.parse(input.startsAt);
    const endsAt = input.endsAt === null ? null : Date.parse(input.endsAt);
    if (startsAt !== null && endsAt !== null && endsAt <= startsAt)
      throw new ValidationError("The notice must end after it starts.");
    return [
      input.title,
      input.body,
      html,
      JSON.stringify(input.rule),
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
          "INSERT INTO notices (title, body_source, body_html, rule, dismissible, active, starts_at, ends_at, created_by, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)",
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
        "UPDATE notices SET title = ?1, body_source = ?2, body_html = ?3, rule = ?4, dismissible = ?5, active = ?6, starts_at = ?7, ends_at = ?8, updated_at = ?9 WHERE id = ?10",
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
