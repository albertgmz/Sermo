import * as z from "zod";
import type { Actor } from "../../actor";
import { type Ctx, cached, invalidate, prepared } from "../../context";
import {
  WIDGET_LIMIT,
  WIDGET_OPTIONS,
  WIDGET_PAGE_POSITIONS,
  type Widget,
  type WidgetDetail,
  widgetPhonesByDefault,
  widgetsCreate,
  widgetsCurrent,
  widgetsDelete,
  widgetsDuplicate,
  widgetsList,
  widgetsReorder,
  widgetsUpdate,
} from "../../contracts/widgets";
import { WIDGET_POSITIONS, type WidgetPosition, type WidgetType } from "../../db/schema";
import { writeTx } from "../../db/tx";
import { ConflictError, NotFoundError, ValidationError } from "../../errors";
import { implement } from "../../operation";
import { requirePermission } from "../../permissions";
import { renderBbCode } from "../../render";
import { actorFacts, assertRule, evaluate, parseRule, type Rule } from "../../shared/criteria";
import { iso } from "../../time";

type Page = keyof typeof WIDGET_PAGE_POSITIONS;
type Shown = z.infer<typeof Widget>;
type Detail = z.infer<typeof WidgetDetail>;

interface WidgetRow {
  id: number;
  position: WidgetPosition;
  type: WidgetType;
  display_order: number;
  title: string | null;
  options: string;
  rule: string;
  phones: number;
  is_enabled: number;
  created_at: number;
  updated_at: number;
}

type Stored = readonly [string, string | null, string, string, number, number];

export const widgetsSql = {
  enabled: "SELECT * FROM widgets WHERE is_enabled = 1",
  all: "SELECT * FROM widgets",
  one: "SELECT * FROM widgets WHERE id = ?1",
  count: "SELECT COUNT(*) AS n FROM widgets",
  inPosition: "SELECT id FROM widgets WHERE position = ?1 ORDER BY display_order, id",
  insert:
    "INSERT INTO widgets (position, type, display_order, title, options, rule, phones, is_enabled, created_at, updated_at) VALUES (?1, ?2, (SELECT COALESCE(MAX(display_order), -1) + 1 FROM widgets WHERE position = ?1), ?3, ?4, ?5, ?6, ?7, ?8, ?8) RETURNING *",
  copy: "INSERT INTO widgets (position, type, display_order, title, options, rule, phones, is_enabled, created_at, updated_at) SELECT ?1, type, (SELECT COALESCE(MAX(display_order), -1) + 1 FROM widgets WHERE position = ?1), title, options, rule, phones, is_enabled, ?2, ?2 FROM widgets WHERE id = ?3 RETURNING *",
  update:
    "UPDATE widgets SET display_order = CASE WHEN position = ?1 THEN display_order ELSE (SELECT COALESCE(MAX(display_order), -1) + 1 FROM widgets WHERE position = ?1) END, position = ?1, title = ?2, options = ?3, rule = ?4, phones = ?5, is_enabled = ?6, updated_at = ?7 WHERE id = ?8",
  place: "UPDATE widgets SET display_order = ?1 WHERE id = ?2",
  delete: "DELETE FROM widgets WHERE id = ?1",
};

function query<Row, Params extends (string | number | null)[]>(
  ctx: Ctx,
  key: keyof typeof widgetsSql,
) {
  return prepared(ctx, `widgets.${key}`, () => ctx.sqlite.prepare<Row, Params>(widgetsSql[key]));
}

/** The stored options of a type without the keys it no longer has, and the defaults of new ones. */
const readers = Object.fromEntries(
  Object.entries(WIDGET_OPTIONS).map(([type, schema]) => [type, z.object(schema.shape)]),
) as Record<WidgetType, z.ZodObject>;

/** The `type`, `options` and, for a text widget, `bodyHtml` of a row. */
function typed(row: WidgetRow) {
  const stored = JSON.parse(row.options) as { bodyHtml?: string };
  const { bodyHtml, ...options } = stored;
  const value = {
    type: row.type,
    options: readers[row.type].parse(options) as Record<string, unknown>,
  };
  return row.type === "text" ? { ...value, bodyHtml: bodyHtml ?? "" } : value;
}

function shown(row: WidgetRow): Shown {
  return {
    id: row.id,
    position: row.position,
    title: row.title,
    phones: !!row.phones,
    ...typed(row),
  } as Shown;
}

function detail(row: WidgetRow): Detail {
  return {
    id: row.id,
    position: row.position,
    displayOrder: row.display_order,
    title: row.title,
    phones: !!row.phones,
    isEnabled: !!row.is_enabled,
    rule: parseRule(row.rule),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    ...typed(row),
  } as Detail;
}

const positionIndex = (position: WidgetPosition) => WIDGET_POSITIONS.indexOf(position);

function widgetRow(ctx: Ctx, id: number): WidgetRow {
  const row = query<WidgetRow, [number]>(ctx, "one").get(id);
  if (!row) throw new NotFoundError();
  return row;
}

interface Entry {
  item: Shown;
  /** The rule when it names conditions; null shows the widget to everyone. */
  rule: Rule | null;
}

/** The enabled widgets of every page, in drawing order, in one cache; invalidated by each write. */
function snapshot(ctx: Ctx): Record<Page, Entry[]> {
  return cached(ctx, "widgets", () => {
    const rows = query<WidgetRow, []>(ctx, "enabled")
      .all()
      .sort(
        (a, b) =>
          positionIndex(a.position) - positionIndex(b.position) ||
          a.display_order - b.display_order ||
          a.id - b.id,
      );
    const entries = rows.map((row): [WidgetPosition, Entry] => {
      const rule = parseRule(row.rule);
      return [row.position, { item: shown(row), rule: rule.conditions.length ? rule : null }];
    });
    return Object.fromEntries(
      (Object.keys(WIDGET_PAGE_POSITIONS) as Page[]).map((page) => {
        const drawn: readonly WidgetPosition[] = WIDGET_PAGE_POSITIONS[page];
        return [
          page,
          drawn.flatMap((position) =>
            entries.filter(([at]) => at === position).map(([, entry]) => entry),
          ),
        ];
      }),
    ) as Record<Page, Entry[]>;
  });
}

/** The widgets of a page the actor is shown. */
function shownTo(ctx: Ctx, actor: Actor, page: Page): Shown[] {
  const entries = snapshot(ctx)[page];
  const rules = entries.flatMap((entry) => (entry.rule ? [entry.rule] : []));
  if (!rules.length) return entries.map((entry) => entry.item);
  const facts = actorFacts(ctx, actor, rules);
  return entries
    .filter((entry) => !entry.rule || evaluate(entry.rule, facts))
    .map((entry) => entry.item);
}

type Fields = {
  type: WidgetType;
  options: Record<string, unknown>;
  title: string | null;
  rule: Rule;
  phones: boolean;
  isEnabled: boolean;
};

/**
 * Renders a text widget's body (before any transaction) and returns the check that builds the
 * stored columns: type, title, options, rule, phone switch, enabled switch.
 */
function prepare(input: Fields): (ctx: Ctx) => Stored {
  const options = WIDGET_OPTIONS[input.type].parse(input.options) as Record<string, unknown>;
  const html = input.type === "text" ? renderBbCode(String(options.body)) : null;
  return (ctx) => {
    assertRule(ctx, input.rule, "cheap");
    return [
      input.type,
      input.title,
      JSON.stringify(html === null ? options : { ...options, bodyHtml: html }),
      JSON.stringify(input.rule),
      input.phones ? 1 : 0,
      input.isEnabled ? 1 : 0,
    ];
  };
}

function requireRoom(ctx: Ctx): void {
  if (query<{ n: number }, []>(ctx, "count").get()!.n >= WIDGET_LIMIT)
    throw new ConflictError(`The site holds at most ${WIDGET_LIMIT} widgets.`);
}

const current = implement(
  widgetsCurrent,
  (ctx, actor, input) => ({ items: shownTo(ctx, actor, input.page) }),
  {
    public: "Every visitor sees the widgets meant for them; nothing about a member is returned.",
  },
);

const list = implement(widgetsList, (ctx, actor) => {
  requirePermission(ctx, actor, "admin.widgets");
  return {
    items: query<WidgetRow, []>(ctx, "all")
      .all()
      .sort(
        (a, b) =>
          positionIndex(a.position) - positionIndex(b.position) ||
          a.display_order - b.display_order ||
          a.id - b.id,
      )
      .map(detail),
  };
});

const create = implement(widgetsCreate, (ctx, actor, input) => {
  requirePermission(ctx, actor, "admin.widgets");
  const stored = prepare({
    ...input,
    phones: input.phones ?? widgetPhonesByDefault(input.type),
  });
  return writeTx(ctx, () => {
    requireRoom(ctx);
    const [type, title, options, rule, phones, enabled] = stored(ctx);
    const row = query<WidgetRow, (string | number | null)[]>(ctx, "insert").get(
      input.position,
      type,
      title,
      options,
      rule,
      phones,
      enabled,
      ctx.now(),
    )!;
    invalidate(ctx, "widgets");
    return detail(row);
  });
});

const update = implement(widgetsUpdate, (ctx, actor, input) => {
  requirePermission(ctx, actor, "admin.widgets");
  const stored = prepare(input);
  return writeTx(ctx, () => {
    const row = widgetRow(ctx, input.widgetId);
    const [type, title, options, rule, phones, enabled] = stored(ctx);
    if (type !== row.type) throw new ValidationError("A widget keeps its type.");
    query<unknown, (string | number | null)[]>(ctx, "update").run(
      input.position,
      title,
      options,
      rule,
      phones,
      enabled,
      ctx.now(),
      row.id,
    );
    invalidate(ctx, "widgets");
    return detail(widgetRow(ctx, row.id));
  });
});

const duplicate = implement(widgetsDuplicate, (ctx, actor, input) => {
  requirePermission(ctx, actor, "admin.widgets");
  return writeTx(ctx, () => {
    const source = widgetRow(ctx, input.widgetId);
    requireRoom(ctx);
    const row = query<WidgetRow, [string, number, number]>(ctx, "copy").get(
      input.position ?? source.position,
      ctx.now(),
      source.id,
    )!;
    invalidate(ctx, "widgets");
    return detail(row);
  });
});

const reorder = implement(widgetsReorder, (ctx, actor, input) => {
  requirePermission(ctx, actor, "admin.widgets");
  return writeTx(ctx, () => {
    const held = query<{ id: number }, [string]>(ctx, "inPosition")
      .all(input.position)
      .map((row) => row.id);
    const listed = new Set(input.ids);
    if (
      listed.size !== input.ids.length ||
      listed.size !== held.length ||
      held.some((id) => !listed.has(id))
    )
      throw new ValidationError("List every widget of the position, once each.");
    const place = query<unknown, [number, number]>(ctx, "place");
    input.ids.forEach((id, index) => {
      place.run(index, id);
    });
    invalidate(ctx, "widgets");
    return { ok: true as const };
  });
});

const remove = implement(widgetsDelete, (ctx, actor, input) => {
  requirePermission(ctx, actor, "admin.widgets");
  return writeTx(ctx, () => {
    const changed = query<unknown, [number]>(ctx, "delete").run(input.widgetId).changes;
    if (!changed) throw new NotFoundError();
    invalidate(ctx, "widgets");
    return { ok: true as const };
  });
});

export const operations = [current, list, create, update, duplicate, reorder, remove];
