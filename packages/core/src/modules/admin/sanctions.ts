import * as z from "zod";
import { requireAuthenticated } from "../../actor";
import { prepared } from "../../context";
import {
  announcementsList,
  approvalsViewConversationMessage,
  bansList,
} from "../../contracts/admin";
import { writeTx } from "../../db/tx";
import { NotFoundError } from "../../errors";
import { implement } from "../../operation";
import { decodeCursor, encodeCursor } from "../../pagination";
import { currentActor, requirePermission } from "../../permissions";
import { loadUserSummaries } from "../../shared/users";
import { iso, isoOrNull } from "../../time";
import { scanKeyset } from "../feed/scan";
import { contentAuthor } from "../forums/guest-author";
import { appendModeratorLog } from "../moderation";
import { requireHeld } from "./shared";

const Cursor = z.tuple([z.number().int().positive()]);

// bans.list ---------------------------------------------------------------------------------

interface BanRow {
  id: number;
  user_id: number;
  moderator_id: number;
  reason: string;
  created_at: number;
  expires_at: number | null;
  lifted_at: number | null;
}
export const bansSql = {
  all: "SELECT id, user_id, moderator_id, reason, created_at, expires_at, lifted_at FROM bans WHERE id < ?1 ORDER BY id DESC LIMIT ?2",
  member:
    "SELECT id, user_id, moderator_id, reason, created_at, expires_at, lifted_at FROM bans WHERE user_id = ?3 AND id < ?1 ORDER BY id DESC LIMIT ?2",
};
const banState = (row: BanRow, now: number) =>
  row.lifted_at !== null
    ? ("lifted" as const)
    : row.expires_at !== null && row.expires_at <= now
      ? ("expired" as const)
      : ("active" as const);

export const bansListOp = implement(bansList, (ctx, actor, input) => {
  requireHeld(ctx, actor, "member.ban");
  const now = ctx.now();
  const source = input.userId === undefined ? "all" : "member";
  const statement = prepared(ctx, `admin.bans.${source}`, () =>
    ctx.sqlite.prepare<BanRow, (number | string)[]>(bansSql[source]),
  );
  // A bounded walk of the key (or of the member's bans); the state is judged on the rows read.
  const scan = scanKeyset<BanRow, number[]>({
    before: input.cursor ? decodeCursor(input.cursor, Cursor) : null,
    limit: input.limit,
    fetch: (before, count) =>
      source === "all"
        ? statement.all(before ? before[0]! : Number.MAX_SAFE_INTEGER, count)
        : statement.all(before ? before[0]! : Number.MAX_SAFE_INTEGER, count, input.userId!),
    keyOf: (row) => [row.id],
    accept: (rows) =>
      new Set(rows.filter((row) => !input.state || banState(row, now) === input.state)),
  });
  const name = loadUserSummaries(
    ctx,
    scan.items.flatMap((row) => [row.user_id, row.moderator_id]),
  );
  return {
    items: scan.items.map((row) => ({
      id: row.id,
      user: name(row.user_id),
      moderator: name(row.moderator_id),
      reason: row.reason,
      createdAt: iso(row.created_at),
      expiresAt: isoOrNull(row.expires_at),
      liftedAt: isoOrNull(row.lifted_at),
      state: banState(row, now),
    })),
    nextCursor: scan.next ? encodeCursor(scan.next) : null,
  };
});

// announcements.list ------------------------------------------------------------------------

export const announcementsSql =
  "SELECT id, user_id, title, body_html, created_at, url, audience, audience_group_id, audience_user_ids FROM announcements WHERE id < ?1 ORDER BY id DESC LIMIT ?2";

export const announcementsListOp = implement(announcementsList, (ctx, actor, input) => {
  requirePermission(ctx, actor, "admin.announcements");
  const cursor = input.cursor ? decodeCursor(input.cursor, Cursor)[0] : Number.MAX_SAFE_INTEGER;
  const rows = prepared(ctx, "admin.announcements", () =>
    ctx.sqlite.prepare<
      {
        id: number;
        user_id: number;
        title: string;
        body_html: string;
        created_at: number;
        url: string | null;
        audience: "all" | "group" | "users";
        audience_group_id: number | null;
        audience_user_ids: string;
      },
      [number, number]
    >(announcementsSql),
  ).all(cursor, input.limit + 1);
  const page = rows.slice(0, input.limit);
  const name = loadUserSummaries(ctx, [
    ...page.map((row) => row.user_id),
    ...page.flatMap((row) =>
      row.audience === "users" ? (JSON.parse(row.audience_user_ids) as number[]) : [],
    ),
  ]);
  return {
    items: page.map((row) => ({
      id: row.id,
      title: row.title,
      bodyHtml: row.body_html,
      url: row.url,
      audience:
        row.audience === "group"
          ? { kind: "group" as const, groupId: row.audience_group_id ?? 0 }
          : row.audience === "users"
            ? {
                kind: "users" as const,
                usernames: (JSON.parse(row.audience_user_ids) as number[]).map(
                  (id) => name(id).username,
                ),
              }
            : { kind: "all" as const },
      author: name(row.user_id),
      createdAt: iso(row.created_at),
    })),
    nextCursor: rows.length > input.limit ? encodeCursor([page[page.length - 1]!.id]) : null,
  };
});

// approvals.viewConversationMessage ---------------------------------------------------------

interface Message {
  id: number;
  user_id: number;
  body_html: string;
  created_at: number;
}
const MESSAGE = "m.id, m.user_id, m.body_html, m.created_at";
export const approvalMessageSql = {
  target:
    "SELECT m.conversation_id, c.title FROM conversation_messages m JOIN conversations c ON c.id = m.conversation_id WHERE m.id = ?1 AND m.state = 'moderated'",
  before: `SELECT ${MESSAGE} FROM conversation_messages m WHERE m.conversation_id = ?1 AND m.id < ?2 AND m.state = 'visible' ORDER BY m.id DESC LIMIT 3`,
  center: `SELECT ${MESSAGE} FROM conversation_messages m WHERE m.id = ?1`,
  after: `SELECT ${MESSAGE} FROM conversation_messages m WHERE m.conversation_id = ?1 AND m.id > ?2 AND m.state = 'visible' ORDER BY m.id LIMIT 3`,
};

export const approvalsViewConversationMessageOp = implement(
  approvalsViewConversationMessage,
  (ctx, actor, input) => {
    requireAuthenticated(actor);
    requirePermission(ctx, actor, "conversation.moderate");
    return writeTx(ctx, () => {
      // Logged reads depend on the actor's standing: decide with what is committed now.
      const current = currentActor(ctx, actor);
      requirePermission(ctx, current, "conversation.moderate");
      const target = prepared(ctx, "admin.approvalTarget", () =>
        ctx.sqlite.prepare<{ conversation_id: number; title: string }, [number]>(
          approvalMessageSql.target,
        ),
      ).get(input.messageId);
      if (!target) throw new NotFoundError();
      const read = (key: "before" | "after") =>
        prepared(ctx, `admin.approval.${key}`, () =>
          ctx.sqlite.prepare<Message, [number, number]>(approvalMessageSql[key]),
        ).all(target.conversation_id, input.messageId);
      const center = prepared(ctx, "admin.approval.center", () =>
        ctx.sqlite.prepare<Message, [number]>(approvalMessageSql.center),
      ).get(input.messageId)!;
      const messages = [...read("before").reverse(), center, ...read("after")];
      const name = loadUserSummaries(
        ctx,
        messages.map((m) => m.user_id),
      );
      appendModeratorLog(
        ctx,
        actor,
        "conversation_message.view",
        "conversation_message",
        input.messageId,
        "",
        { queue: "approvals" },
      );
      return {
        conversationId: target.conversation_id,
        title: target.title,
        messages: messages.map((m) => ({
          id: m.id,
          author: contentAuthor(name, m.user_id, null),
          bodyHtml: m.body_html,
          createdAt: iso(m.created_at),
          isTarget: m.id === input.messageId,
        })),
      };
    });
  },
);
