import type { SQLQueryBindings } from "bun:sqlite";
import { type Actor, GUEST, requireAuthenticated } from "../../actor";
import { type Ctx, prepared } from "../../context";
import {
  warningActionsCreate,
  warningActionsDelete,
  warningActionsList,
  warningActionsUpdate,
  warningTypesCreate,
  warningTypesDelete,
  warningTypesList,
  warningTypesUpdate,
} from "../../contracts/moderation";
import type { RestrictionKind, WarningActionKind } from "../../db/schema";
import { writeTx } from "../../db/tx";
import { ForbiddenError, NotFoundError, ValidationError } from "../../errors";
import type { Language } from "../../i18n";
import { implement } from "../../operation";
import {
  can,
  currentActor,
  groupDecidesAdministration,
  memberStanding,
  requirePermission,
} from "../../permissions";
import { viewerLanguage } from "../../shared/language";
import { appendModeratorLog } from "./index";
import { releaseActionGroups } from "./warning-actions";

const DAY_MS = 86_400_000;

type TypeRow = {
  id: number;
  name_en: string;
  name_es: string;
  points: number;
  expiry_days: number | null;
  default_reason: string;
  locked: number;
};
type ActionRow = {
  id: number;
  threshold: number;
  kind: WarningActionKind;
  days: number | null;
  group_id: number | null;
  group_title: string | null;
  restriction_kind: RestrictionKind | null;
};

function statement<T>(ctx: Ctx, key: string, sql: string) {
  return prepared(ctx, `moderation.warningConfig.${key}`, () =>
    ctx.sqlite.prepare<T, SQLQueryBindings[]>(sql),
  );
}

const typeColumns = "id, name_en, name_es, points, expiry_days, default_reason, locked";

function typeValue(row: TypeRow, language: Language) {
  return {
    id: row.id,
    name: language === "es" ? row.name_es : row.name_en,
    nameEn: row.name_en,
    nameEs: row.name_es,
    points: row.points,
    expiryDays: row.expiry_days,
    defaultReason: row.default_reason,
    locked: row.locked !== 0,
  };
}

function actionValue(row: ActionRow) {
  return {
    id: row.id,
    threshold: row.threshold,
    kind: row.kind,
    days: row.days,
    groupId: row.group_id,
    groupTitle: row.group_title,
    restrictionKind: row.restriction_kind,
  };
}

/**
 * What a warning is given with: the type's points, expiry and reason unless the moderator
 * changes them, which a locked type does not allow. Without a type, points and a reason are
 * required and the expiry is the one given (null = never). Inside the write transaction.
 */
export function resolveWarning(
  ctx: Ctx,
  now: number,
  input: {
    points: number | undefined;
    reason: string | undefined;
    expiresAt: number | null | undefined;
    typeId: number | undefined;
  },
): { points: number; reason: string; expiresAt: number | null } {
  let { points, reason, expiresAt } = input;
  if (input.typeId !== undefined) {
    const type = statement<TypeRow>(
      ctx,
      "typeById",
      `SELECT ${typeColumns} FROM warning_types WHERE id = ?1`,
    ).get(input.typeId);
    if (!type) throw new NotFoundError();
    if (
      type.locked &&
      ((points !== undefined && points !== type.points) || expiresAt !== undefined)
    )
      throw new ValidationError("This warning type fixes its points and its expiry.");
    points ??= type.points;
    if (reason === undefined || !reason.trim()) reason = type.default_reason;
    if (expiresAt === undefined)
      expiresAt = type.expiry_days === null ? null : now + type.expiry_days * DAY_MS;
  }
  if (points === undefined || !reason?.trim())
    throw new ValidationError("Positive points and a reason are required.");
  return { points, reason, expiresAt: expiresAt ?? null };
}

/** Moderators pick a type when warning, administrators manage the list. */
function requireTypeReader(ctx: Ctx, actor: Actor): void {
  requireAuthenticated(actor);
  if (can(ctx, actor, "member.warn", { target: GUEST }) || can(ctx, actor, "admin.settings"))
    return;
  throw new ForbiddenError();
}

const listTypes = (ctx: Ctx, language: Language) =>
  statement<TypeRow>(ctx, "types", `SELECT ${typeColumns} FROM warning_types ORDER BY id`)
    .all()
    .map((row) => typeValue(row, language));

export const warningTypesListOp = implement(warningTypesList, (ctx, actor) => {
  requireTypeReader(ctx, actor);
  return { items: listTypes(ctx, viewerLanguage(ctx, actor)) };
});

export const warningTypesCreateOp = implement(warningTypesCreate, (ctx, actor, input) => {
  requirePermission(ctx, actor, "admin.settings");
  return writeTx(ctx, () => {
    requirePermission(ctx, currentActor(ctx, actor), "admin.settings");
    const row = statement<TypeRow>(
      ctx,
      "typeInsert",
      `INSERT INTO warning_types (name_en, name_es, points, expiry_days, default_reason, locked, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) RETURNING ${typeColumns}`,
    ).get(
      input.nameEn,
      input.nameEs,
      input.points,
      input.expiryDays,
      input.defaultReason,
      Number(input.locked),
      ctx.now(),
    )!;
    appendModeratorLog(ctx, actor, "warning_type.create", "warning_type", row.id, "", {
      name: row.name_en,
    });
    return typeValue(row, viewerLanguage(ctx, actor));
  });
});

export const warningTypesUpdateOp = implement(warningTypesUpdate, (ctx, actor, input) => {
  requirePermission(ctx, actor, "admin.settings");
  return writeTx(ctx, () => {
    requirePermission(ctx, currentActor(ctx, actor), "admin.settings");
    const row = statement<TypeRow>(
      ctx,
      "typeUpdate",
      `UPDATE warning_types SET name_en = ?2, name_es = ?3, points = ?4, expiry_days = ?5, default_reason = ?6, locked = ?7 WHERE id = ?1 RETURNING ${typeColumns}`,
    ).get(
      input.typeId,
      input.nameEn,
      input.nameEs,
      input.points,
      input.expiryDays,
      input.defaultReason,
      Number(input.locked),
    );
    if (!row) throw new NotFoundError();
    appendModeratorLog(ctx, actor, "warning_type.update", "warning_type", row.id, "", {
      name: row.name_en,
    });
    return typeValue(row, viewerLanguage(ctx, actor));
  });
});

export const warningTypesDeleteOp = implement(warningTypesDelete, (ctx, actor, input) => {
  requirePermission(ctx, actor, "admin.settings");
  return writeTx(ctx, () => {
    requirePermission(ctx, currentActor(ctx, actor), "admin.settings");
    // Warnings keep their points, expiry and reason; they only forget the label.
    statement(ctx, "typeForget", "UPDATE warnings SET type_id = NULL WHERE type_id = ?1").run(
      input.typeId,
    );
    const removed = statement<{ name_en: string }>(
      ctx,
      "typeDelete",
      "DELETE FROM warning_types WHERE id = ?1 RETURNING name_en",
    ).get(input.typeId);
    if (!removed) throw new NotFoundError();
    appendModeratorLog(ctx, actor, "warning_type.delete", "warning_type", input.typeId, "", {
      name: removed.name_en,
    });
    return { ok: true as const };
  });
});

const actionColumns =
  "a.id, a.threshold, a.kind, a.days, a.group_id, g.title AS group_title, a.restriction_kind";
const actionFrom = "warning_actions a LEFT JOIN groups g ON g.id = a.group_id";

export const warningActionsListOp = implement(warningActionsList, (ctx, actor) => {
  requirePermission(ctx, actor, "admin.settings");
  return {
    items: statement<ActionRow>(
      ctx,
      "actions",
      `SELECT ${actionColumns} FROM ${actionFrom} ORDER BY a.threshold, a.id`,
    )
      .all()
      .map(actionValue),
  };
});

type ActionInput = {
  threshold: number;
  kind: WarningActionKind;
  days: number | null;
  groupId: number | null;
  restrictionKind: RestrictionKind | null;
};

/** The fields an action's kind needs, and only those; a group the actor may hand out. */
function checkAction(ctx: Ctx, current: Actor, input: ActionInput) {
  if (input.kind === "group") {
    if (input.groupId === null || input.restrictionKind !== null)
      throw new ValidationError("A group action needs a group and no restriction.");
    const group = statement<{ rank: number; builtin: string | null }>(
      ctx,
      "group",
      "SELECT rank, builtin FROM groups WHERE id = ?1",
    ).get(input.groupId);
    if (!group) throw new NotFoundError();
    if (group.builtin === "guest") throw new ValidationError("The guest group cannot be assigned.");
    // Nobody hands out a group ranked at or above their own.
    if (group.rank >= memberStanding(ctx, current).maxRank) throw new ForbiddenError();
    if (groupDecidesAdministration(ctx, input.groupId))
      throw new ValidationError(
        "A group that administers permissions cannot be added by a warning.",
      );
  } else if (input.kind === "restriction") {
    if (input.restrictionKind === null || input.groupId !== null)
      throw new ValidationError("A restriction action needs a restriction kind and no group.");
  } else if (input.groupId !== null || input.restrictionKind !== null) {
    throw new ValidationError("A ban action takes no group and no restriction.");
  }
}

function readAction(ctx: Ctx, id: number): ActionRow {
  const row = statement<ActionRow>(
    ctx,
    "actionById",
    `SELECT ${actionColumns} FROM ${actionFrom} WHERE a.id = ?1`,
  ).get(id);
  if (!row) throw new NotFoundError();
  return row;
}

export const warningActionsCreateOp = implement(warningActionsCreate, (ctx, actor, input) => {
  requirePermission(ctx, actor, "admin.settings");
  return writeTx(ctx, () => {
    const current = currentActor(ctx, actor);
    requirePermission(ctx, current, "admin.settings");
    checkAction(ctx, current, input);
    const id = statement<{ id: number }>(
      ctx,
      "actionInsert",
      "INSERT INTO warning_actions (threshold, kind, days, group_id, restriction_kind, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6) RETURNING id",
    ).get(
      input.threshold,
      input.kind,
      input.days,
      input.groupId,
      input.restrictionKind,
      ctx.now(),
    )!.id;
    appendModeratorLog(ctx, actor, "warning_action.create", "warning_action", id, "", {
      threshold: input.threshold,
      kind: input.kind,
    });
    return actionValue(readAction(ctx, id));
  });
});

export const warningActionsUpdateOp = implement(warningActionsUpdate, (ctx, actor, input) => {
  requirePermission(ctx, actor, "admin.settings");
  return writeTx(ctx, () => {
    const current = currentActor(ctx, actor);
    requirePermission(ctx, current, "admin.settings");
    readAction(ctx, input.actionId);
    checkAction(ctx, current, input);
    statement(
      ctx,
      "actionUpdate",
      "UPDATE warning_actions SET threshold = ?2, kind = ?3, days = ?4, group_id = ?5, restriction_kind = ?6 WHERE id = ?1",
    ).run(
      input.actionId,
      input.threshold,
      input.kind,
      input.days,
      input.groupId,
      input.restrictionKind,
    );
    appendModeratorLog(ctx, actor, "warning_action.update", "warning_action", input.actionId, "", {
      threshold: input.threshold,
      kind: input.kind,
    });
    return actionValue(readAction(ctx, input.actionId));
  });
});

export const warningActionsDeleteOp = implement(warningActionsDelete, (ctx, actor, input) => {
  requirePermission(ctx, actor, "admin.settings");
  return writeTx(ctx, () => {
    requirePermission(ctx, currentActor(ctx, actor), "admin.settings");
    readAction(ctx, input.actionId);
    // Timed memberships it added end now; the fires go with the row.
    releaseActionGroups(ctx, input.actionId);
    statement(ctx, "actionDelete", "DELETE FROM warning_actions WHERE id = ?1").run(input.actionId);
    appendModeratorLog(ctx, actor, "warning_action.delete", "warning_action", input.actionId);
    return { ok: true as const };
  });
});
