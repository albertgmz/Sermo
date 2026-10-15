import type * as z from "zod";
import { type Actor, requireAuthenticated } from "../../actor";
import { type Ctx, prepared } from "../../context";
import {
  BATCH_MEMBER_LIMIT,
  BATCH_SCAN_LIMIT,
  type BatchAction,
  type MemberSelection,
  usersBatchPreview,
  usersBatchUpdate,
} from "../../contracts/batch";
import { ValidationError } from "../../errors";
import { implement } from "../../operation";
import { assertRule, evaluate, loadFacts } from "../../shared/criteria";
import { banUser, liftBan, requireBanLength } from "../moderation";
import { changeMemberGroups } from "../permissions";
import { profileFieldChanges } from "../profiles/fields";
import { eraseAsAdministrator } from "./erase";
import { outcomeOf, SkipMember, tally } from "./outcomes";
import { editMemberProfile } from "./profile";
import { confirmActorPassword, requireHeld, requireNotErased, verifyActorPassword } from "./shared";
import { isSuperAdminRow } from "./super-admin";

/*
 * Batch update members: one action applied to up to `BATCH_MEMBER_LIMIT` members chosen by
 * the criteria engine or by a list. Each member goes through the single action's own helper
 * (its permission and hierarchy checks, its own transaction, its own moderator log entry), so a
 * member the actor may not act on is skipped and the rest go on.
 */

type Picked = { id: number; username: string };
type Selection = z.output<typeof MemberSelection>;
type Action = z.output<typeof BatchAction>;

/** Members are read this many at a time while a criteria selection looks for matches. */
const SCAN_CHUNK = 200;
const DAY_MS = 86_400_000;

export const batchSql = {
  scan: "SELECT id, username FROM users WHERE id > ?1 AND erased_at IS NULL ORDER BY id LIMIT ?2",
  named:
    "SELECT id, username, username_key FROM users WHERE id IN (SELECT value FROM json_each(?1)) OR username_key IN (SELECT value FROM json_each(?2))",
  title: "SELECT custom_title FROM users WHERE id = ?1",
  signature: "SELECT signature_source FROM users WHERE id = ?1",
  erased:
    "SELECT u.erased_at, u.username_key, a.email FROM users u JOIN auth_user a ON a.id = u.id WHERE u.id = ?1",
  names: "SELECT id, username FROM users WHERE id IN (SELECT value FROM json_each(?1))",
  bans: "SELECT id FROM bans WHERE user_id = ?1 AND lifted_at IS NULL AND (expires_at IS NULL OR expires_at > ?2) ORDER BY id",
};

/**
 * The members a selection names. A list is resolved by id (a word of digits) or username, in the
 * order given, each once; what matched nobody is returned apart. A criteria selection walks the
 * members in id order after `after`, looks at no more than `BATCH_SCAN_LIMIT` of them and keeps
 * the first `BATCH_MEMBER_LIMIT` that hold the rule; `next` is where it stopped (null when the
 * members ran out).
 */
async function pick(
  ctx: Ctx,
  selection: Selection,
): Promise<{ members: Picked[]; unknown: string[]; next: number | null }> {
  if (selection.kind === "list") {
    const ids: number[] = [];
    const keys: string[] = [];
    for (const word of selection.members)
      if (/^\d+$/.test(word) && Number.isSafeInteger(Number(word)) && Number(word) > 0)
        ids.push(Number(word));
      else keys.push(word.toLowerCase());
    const rows = prepared(ctx, "batch.named", () =>
      ctx.sqlite.prepare<Picked & { username_key: string }, [string, string]>(batchSql.named),
    ).all(JSON.stringify(ids), JSON.stringify(keys));
    const byId = new Map(rows.map((row) => [row.id, row]));
    const byKey = new Map(rows.map((row) => [row.username_key, row]));
    const members: Picked[] = [];
    const unknown: string[] = [];
    const seen = new Set<number>();
    for (const word of selection.members) {
      const row = /^\d+$/.test(word) ? byId.get(Number(word)) : byKey.get(word.toLowerCase());
      if (!row) unknown.push(word);
      else if (!seen.has(row.id)) {
        seen.add(row.id);
        members.push({ id: row.id, username: row.username });
      }
    }
    return { members, unknown, next: null };
  }
  // Only criteria cheap to check in a request: the ones that count a history are for background jobs.
  assertRule(ctx, selection.rule, "cheap");
  const found: Picked[] = [];
  let after = selection.after ?? 0;
  let scanned = 0;
  while (found.length < BATCH_MEMBER_LIMIT && scanned < BATCH_SCAN_LIMIT) {
    const rows = prepared(ctx, "batch.scan", () =>
      ctx.sqlite.prepare<Picked, [number, number]>(batchSql.scan),
    ).all(after, Math.min(SCAN_CHUNK, BATCH_SCAN_LIMIT - scanned));
    if (rows.length === 0) return { members: found, unknown: [], next: null };
    const facts = loadFacts(
      ctx,
      rows.map((row) => row.id),
      [selection.rule],
    );
    // A long scan lets other requests through between chunks.
    await new Promise((resolve) => setImmediate(resolve));
    for (const row of rows) {
      after = row.id;
      scanned++;
      if (evaluate(selection.rule, facts.get(row.id)!)) found.push(row);
      if (found.length === BATCH_MEMBER_LIMIT) break;
    }
  }
  return { members: found, unknown: [], next: after };
}

export const usersBatchPreviewOp = implement(usersBatchPreview, async (ctx, actor, input) => {
  requireHeld(ctx, actor, "admin.members");
  const { members, unknown, next } = await pick(ctx, input.selection);
  return { items: members, unknown, next };
});

/** Whether an erased account has been through every step: renamed, and its address replaced. */
function erasureFinished(ctx: Ctx, id: number): boolean {
  const row = prepared(ctx, "batch.erased", () =>
    ctx.sqlite.prepare<{ erased_at: number | null; username_key: string; email: string }, [number]>(
      batchSql.erased,
    ),
  ).get(id);
  return (
    !!row &&
    row.erased_at !== null &&
    row.email === `erased-${id}@invalid` &&
    /^deleted member [0-9]+(-[0-9]+)?$/.test(row.username_key)
  );
}

const needReason = (reason: string) => {
  if (reason === "") throw new ValidationError("A reason is required.");
};

/** What one member goes through, by action; every helper checks the actor's rights over them. */
function member(ctx: Ctx, actor: Actor, action: Action, reason: string, expiresAt: number | null) {
  return async (id: number): Promise<void> => {
    // An erasure that stopped part way is finished by erasing again; anything else leaves an erased account alone.
    if (action.type === "delete") {
      if (erasureFinished(ctx, id)) throw new SkipMember("This member's account was erased.");
    } else requireNotErased(ctx, id);
    if (isSuperAdminRow(ctx, id))
      throw new SkipMember("A super admin is never changed in a batch.");
    switch (action.type) {
      case "setGroup": {
        const done = changeMemberGroups(ctx, actor, id, (held) =>
          held.primaryGroupId === action.groupId ? null : { primaryGroupId: action.groupId },
        );
        if (done === null) throw new SkipMember("Already in that primary group.");
        return;
      }
      case "addGroup": {
        const done = changeMemberGroups(ctx, actor, id, (held) =>
          held.primaryGroupId === action.groupId || held.secondaryGroupIds.includes(action.groupId)
            ? null
            : { secondaryGroupIds: [...held.secondaryGroupIds, action.groupId] },
        );
        if (done === null) throw new SkipMember("Already holds that group.");
        return;
      }
      case "removeGroup": {
        const done = changeMemberGroups(ctx, actor, id, (held) =>
          held.secondaryGroupIds.includes(action.groupId)
            ? {
                secondaryGroupIds: held.secondaryGroupIds.filter(
                  (group) => group !== action.groupId,
                ),
              }
            : null,
        );
        if (done === null) throw new SkipMember("Does not hold that group by hand.");
        return;
      }
      case "setTitle": {
        const wanted = profileFieldChanges(ctx, { customTitle: action.title }).changes.custom_title;
        const held = prepared(ctx, "batch.title", () =>
          ctx.sqlite.prepare<{ custom_title: string | null }, [number]>(batchSql.title),
        ).get(id);
        if ((held?.custom_title ?? null) === wanted)
          throw new SkipMember("Already has that title.");
        editMemberProfile(ctx, actor, { userId: id, customTitle: action.title, reason });
        return;
      }
      case "removeSignature": {
        const held = prepared(ctx, "batch.signature", () =>
          ctx.sqlite.prepare<{ signature_source: string | null }, [number]>(batchSql.signature),
        ).get(id);
        if (!held?.signature_source) throw new SkipMember("Has no signature.");
        editMemberProfile(ctx, actor, { userId: id, signature: null, reason });
        return;
      }
      case "removeAvatar": {
        if (!editMemberProfile(ctx, actor, { userId: id, removeAvatar: true, reason }))
          throw new SkipMember("Has no avatar.");
        return;
      }
      case "ban":
        banUser(ctx, actor, id, reason, expiresAt, { notify: action.notify });
        return;
      case "liftBans": {
        const bans = prepared(ctx, "batch.bans", () =>
          ctx.sqlite.prepare<{ id: number }, [number, number]>(batchSql.bans),
        ).all(id, ctx.now());
        if (bans.length === 0) throw new SkipMember("Has no ban in force.");
        let lifted = 0;
        for (const ban of bans) {
          try {
            liftBan(ctx, actor, ban.id, reason, { notify: action.notify });
            lifted++;
          } catch (error) {
            // Some were lifted before one was refused: the member counts as done, with the rest said.
            if (lifted === 0) throw error;
            throw new SkipMember(
              `Lifted ${lifted} of ${bans.length} bans; the next one was refused.`,
            );
          }
        }
        return;
      }
      case "delete":
        await eraseAsAdministrator(ctx, actor, id, reason);
        return;
    }
  };
}

export const usersBatchUpdateOp = implement(usersBatchUpdate, async (ctx, actor, input) => {
  const { userId: actorId } = requireAuthenticated(actor);
  requireHeld(ctx, actor, "admin.members");
  const { action } = input;
  let expiresAt: number | null = null;
  switch (action.type) {
    case "setGroup":
    case "addGroup":
    case "removeGroup":
      await confirmActorPassword(ctx, actor, input.actorPassword);
      break;
    case "setTitle":
      // The same title for everyone: a title too long is refused once, not member by member.
      profileFieldChanges(ctx, { customTitle: action.title });
      break;
    case "ban":
      requireHeld(ctx, actor, "member.ban");
      needReason(input.reason);
      expiresAt = action.days === null ? null : ctx.now() + action.days * DAY_MS;
      requireBanLength(ctx, actor, expiresAt);
      break;
    case "liftBans":
      requireHeld(ctx, actor, "member.ban");
      break;
    case "delete":
      needReason(input.reason);
      if (input.actorPassword === undefined)
        throw new ValidationError("The acting administrator's password is required.", [
          { path: ["actorPassword"], message: "Required" },
        ]);
      await verifyActorPassword(ctx, actor, input.actorPassword);
      break;
  }
  const ids = [...new Set(input.userIds)];
  const names = new Map(
    prepared(ctx, "batch.names", () => ctx.sqlite.prepare<Picked, [string]>(batchSql.names))
      .all(JSON.stringify(ids))
      .map((row) => [row.id, row.username]),
  );
  const run = member(ctx, actor, action, input.reason, expiresAt);
  const items = [];
  for (const id of ids) {
    const name = names.get(id);
    if (name === undefined) {
      items.push({
        userId: null,
        name: String(id),
        status: "failed" as const,
        message: "No member has this id.",
      });
      continue;
    }
    items.push(
      await outcomeOf(id, name, async () => {
        if (id === actorId) throw new SkipMember("You cannot apply this to yourself.");
        await run(id);
      }),
    );
  }
  return tally(items);
});
