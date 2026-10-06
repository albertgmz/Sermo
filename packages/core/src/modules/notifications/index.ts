import * as z from "zod";
import { type Actor, requireAuthenticated } from "../../actor";
import type { Ctx } from "../../context";
import { prepared } from "../../context";
import * as contracts from "../../contracts/notifications";
import { writeTx } from "../../db/tx";
import { ValidationError } from "../../errors";
import { publishEvent } from "../../events";
import { implement } from "../../operation";
import { decodeCursor, encodeCursor } from "../../pagination";
import { can, requirePermission } from "../../permissions";
import { renderMarkdown } from "../../render";
import { loadUserSummaries } from "../../shared/users";
import { iso } from "../../time";
import { enqueueJob } from "../jobs";
import { readSiteSettings } from "../settings";
import { notificationTypes, typeById } from "./types";

interface Row {
  id: number;
  type: string;
  content_type: string;
  content_id: number;
  thread_id: number | null;
  actor_ids: string;
  actor_count: number;
  data: string;
  created_at: number;
  updated_at: number;
  read_at: number | null;
  epoch: number;
}

export const listSql =
  "SELECT id, type, content_type, content_id, thread_id, actor_ids, actor_count, data, created_at, updated_at, read_at, epoch FROM notifications WHERE user_id = ?1 AND (updated_at, id) < (?2, ?3) ORDER BY updated_at DESC, id DESC LIMIT ?4";
export const listUnreadSql =
  "SELECT id, type, content_type, content_id, thread_id, actor_ids, actor_count, data, created_at, updated_at, read_at, epoch FROM notifications WHERE user_id = ?1 AND epoch = ?2 AND read_at IS NULL AND (updated_at, id) < (?3, ?4) ORDER BY updated_at DESC, id DESC LIMIT ?5";

function readState(
  ctx: Ctx,
  userId: number,
): { unread_notification_count: number; notification_epoch: number } {
  return prepared(ctx, "notifications.readState", () =>
    ctx.sqlite.prepare<{ unread_notification_count: number; notification_epoch: number }, [number]>(
      "SELECT unread_notification_count, notification_epoch FROM users WHERE id = ?1",
    ),
  ).get(userId)!;
}

function titles(ctx: Ctx, actor: Actor, rows: Row[]): Map<string, string> {
  const result = new Map<string, string>();
  const ids = (type: string) =>
    JSON.stringify(rows.filter((row) => row.content_type === type).map((row) => row.content_id));
  for (const [type, table] of [["announcement", "announcements"]] as const) {
    for (const row of prepared(ctx, `notifications.titles.${table}`, () =>
      ctx.sqlite.prepare<{ id: number; title: string }, [string]>(
        `SELECT id, title FROM ${table} WHERE id IN (SELECT value FROM json_each(?1))`,
      ),
    ).all(ids(type)))
      result.set(`${type}:${row.id}`, row.title);
  }
  const threadIds = JSON.stringify(
    rows.map((row) => row.thread_id).filter((id): id is number => id !== null),
  );
  for (const row of prepared(ctx, "notifications.titles.threads", () =>
    ctx.sqlite.prepare<{ id: number; title: string; node_id: number; state: string }, [string]>(
      "SELECT id, title, node_id, state FROM threads WHERE id IN (SELECT value FROM json_each(?1))",
    ),
  ).all(threadIds))
    if (row.state === "visible" && can(ctx, actor, "node.view", { nodeId: row.node_id }))
      result.set(`thread:${row.id}`, row.title);
  const messageConversationIds = rows
    .filter(
      (row) => row.content_type === "conversation_message" || row.content_type === "conversation",
    )
    .map((row) =>
      row.content_type === "conversation"
        ? row.content_id
        : (JSON.parse(row.data) as { conversationId?: number }).conversationId,
    )
    .filter((id): id is number => typeof id === "number");
  const conversationTitles = new Map(
    prepared(ctx, "notifications.titles.conversations", () =>
      ctx.sqlite.prepare<{ id: number; title: string }, [string, number]>(
        "SELECT c.id, c.title FROM conversations c JOIN conversation_participants p ON p.conversation_id = c.id WHERE c.id IN (SELECT value FROM json_each(?1)) AND p.user_id = ?2 AND p.state = 'active'",
      ),
    )
      .all(JSON.stringify(messageConversationIds), requireAuthenticated(actor).userId)
      .map((row) => [row.id, row.title]),
  );
  for (const row of rows) {
    if (row.content_type !== "conversation_message" && row.content_type !== "conversation")
      continue;
    const id =
      row.content_type === "conversation"
        ? row.content_id
        : (JSON.parse(row.data) as { conversationId?: number }).conversationId;
    const title = id ? conversationTitles.get(id) : undefined;
    if (title) result.set(`${row.content_type}:${row.content_id}`, title);
  }
  return result;
}

function url(row: Row): string {
  if (row.thread_id)
    return `/threads/${row.thread_id}${row.content_type === "post" ? `#post-${row.content_id}` : ""}`;
  switch (row.content_type) {
    case "profile_post":
      return `/profile-posts/${row.content_id}`;
    case "profile_post_comment":
      return `/profile-comments/${row.content_id}`;
    case "conversation":
      return `/conversations/${row.content_id}`;
    case "conversation_message":
      return `/conversations/${Number((JSON.parse(row.data) as { conversationId?: number }).conversationId ?? 0)}`;
    case "user":
      return `/users/${row.content_id}`;
    case "announcement":
      return `/announcements/${row.content_id}`;
    case "report_group":
      return `/reports/${row.content_id}`;
    default:
      return "/notifications";
  }
}

export const notificationsListOp = implement(contracts.notificationsList, (ctx, actor, input) => {
  requirePermission(ctx, actor, "notification.view");
  const userId = requireAuthenticated(actor).userId;
  const state = readState(ctx, userId);
  const [at, id] = input.cursor
    ? decodeCursor(input.cursor, z.tuple([z.number().int(), z.number().int()]))
    : [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER];
  const rows = input.unreadOnly
    ? prepared(ctx, "notifications.listUnread", () =>
        ctx.sqlite.prepare<Row, [number, number, number, number, number]>(listUnreadSql),
      ).all(userId, state.notification_epoch, at, id, input.limit + 1)
    : prepared(ctx, "notifications.list", () =>
        ctx.sqlite.prepare<Row, [number, number, number, number]>(listSql),
      ).all(userId, at, id, input.limit + 1);
  const page = rows.slice(0, input.limit);
  const actors = loadUserSummaries(
    ctx,
    page.flatMap((row) => JSON.parse(row.actor_ids) as number[]),
  );
  const contentTitles = titles(ctx, actor, page);
  const hiddenPosts = new Set(
    prepared(ctx, "notifications.hiddenPosts", () =>
      ctx.sqlite.prepare<{ id: number }, [string]>(
        "SELECT id FROM posts WHERE id IN (SELECT value FROM json_each(?1)) AND state != 'visible'",
      ),
    )
      .all(
        JSON.stringify(
          page.filter((row) => row.content_type === "post").map((row) => row.content_id),
        ),
      )
      .map((row) => row.id),
  );
  return {
    items: page.map((row) => ({
      id: row.id,
      type: row.type,
      contentType: row.content_type,
      contentId: row.content_id,
      threadId: row.thread_id,
      actors: (JSON.parse(row.actor_ids) as number[]).map(actors),
      actorCount: row.actor_count,
      contentTitle:
        hiddenPosts.has(row.content_id) && row.content_type === "post"
          ? null
          : (contentTitles.get(`${row.content_type}:${row.content_id}`) ??
            (row.thread_id ? contentTitles.get(`thread:${row.thread_id}`) : undefined) ??
            null),
      url: url(row),
      data: Object.fromEntries(
        Object.entries(JSON.parse(row.data) as Record<string, unknown>).filter(
          ([key]) => !key.startsWith("_"),
        ),
      ),
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
      read: row.read_at !== null || row.epoch !== state.notification_epoch,
    })),
    nextCursor:
      rows.length > input.limit ? encodeCursor([page.at(-1)!.updated_at, page.at(-1)!.id]) : null,
    unreadCount: state.unread_notification_count,
  };
});

export const notificationsMarkReadOp = implement(
  contracts.notificationsMarkRead,
  (ctx, actor, input) => {
    requirePermission(ctx, actor, "notification.view");
    const userId = requireAuthenticated(actor).userId;
    if (!input.all && !input.ids?.length)
      throw new ValidationError("Choose notification ids or all.");
    return writeTx(ctx, () => {
      if (input.all) {
        prepared(ctx, "notifications.markAll", () =>
          ctx.sqlite.prepare<unknown, [number]>(
            "UPDATE users SET notification_epoch = notification_epoch + 1, unread_notification_count = 0 WHERE id = ?1",
          ),
        ).run(userId);
        const epoch = readState(ctx, userId).notification_epoch;
        enqueueJob(
          ctx,
          "notifications.markOldRead",
          { userId, epoch },
          { uniqueKey: `notify-read:${userId}:${epoch}` },
        );
        return { unreadCount: 0 };
      }
      const changed = prepared(ctx, "notifications.markIds", () =>
        ctx.sqlite.prepare<unknown, [number, number, string]>(
          "UPDATE notifications SET read_at = ?1 WHERE user_id = ?2 AND epoch = (SELECT notification_epoch FROM users WHERE id = ?2) AND read_at IS NULL AND id IN (SELECT value FROM json_each(?3))",
        ),
      ).run(ctx.now(), userId, JSON.stringify(input.ids)).changes;
      if (changed)
        prepared(ctx, "notifications.countDownOwn", () =>
          ctx.sqlite.prepare<unknown, [number, number]>(
            "UPDATE users SET unread_notification_count = unread_notification_count - ?1 WHERE id = ?2",
          ),
        ).run(changed, userId);
      return { unreadCount: readState(ctx, userId).unread_notification_count };
    });
  },
);

function effectiveDefaults(
  adminDefaults: ReturnType<typeof readSiteSettings>["notificationDefaults"],
  type: string,
) {
  const definition = typeById.get(type)!;
  return definition.required ? definition.defaults : (adminDefaults[type] ?? definition.defaults);
}

export const notificationsTypesOp = implement(contracts.notificationsTypes, (ctx, actor) => {
  requirePermission(ctx, actor, "notification.view");
  const adminDefaults = readSiteSettings(ctx).notificationDefaults;
  return {
    items: notificationTypes.map((type) => ({
      id: type.id,
      label: type.title,
      description: type.body,
      defaults: effectiveDefaults(adminDefaults, type.id),
      required: type.required,
      channels: type.required
        ? ["email" as const]
        : ["inApp" as const, "email" as const, "push" as const],
    })),
  };
});

export const notificationsPreferencesOp = implement(
  contracts.notificationsPreferences,
  (ctx, actor) => {
    requirePermission(ctx, actor, "notification.view");
    const rows = prepared(ctx, "notifications.ownPreferences", () =>
      ctx.sqlite.prepare<
        { type: string; in_app: number | null; email: number | null; push: number | null },
        [number]
      >("SELECT type, in_app, email, push FROM notification_preferences WHERE user_id = ?1"),
    ).all(requireAuthenticated(actor).userId);
    const overrides = new Map(rows.map((row) => [row.type, row]));
    const adminDefaults = readSiteSettings(ctx).notificationDefaults;
    return {
      items: notificationTypes.map((type) => {
        const base = effectiveDefaults(adminDefaults, type.id);
        const row = overrides.get(type.id);
        return {
          type: type.id,
          inApp: row?.in_app === null || row?.in_app === undefined ? base.inApp : !!row.in_app,
          email: row?.email === null || row?.email === undefined ? base.email : !!row.email,
          push: row?.push === null || row?.push === undefined ? base.push : !!row.push,
        };
      }),
    };
  },
);

export const notificationsSetPreferencesOp = implement(
  contracts.notificationsSetPreferences,
  (ctx, actor, input) => {
    requirePermission(ctx, actor, "notification.view");
    const userId = requireAuthenticated(actor).userId;
    for (const item of input.items) {
      const type = typeById.get(item.type);
      if (!type) throw new ValidationError(`Unknown notification type: ${item.type}`);
      if (type.required && [item.inApp, item.email, item.push].some((value) => value === false))
        throw new ValidationError("A required notification channel cannot be disabled.");
      if (type.required && (item.inApp === true || item.push === true))
        throw new ValidationError("This notification type uses email only.");
    }
    return writeTx(ctx, () => {
      const stmt = prepared(ctx, "notifications.setPreference", () =>
        ctx.sqlite.prepare<unknown, [number, string, number | null, number | null, number | null]>(
          "INSERT INTO notification_preferences (user_id, type, in_app, email, push) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT (user_id, type) DO UPDATE SET in_app = excluded.in_app, email = excluded.email, push = excluded.push",
        ),
      );
      for (const item of input.items) {
        const old = prepared(ctx, "notifications.ownPreference", () =>
          ctx.sqlite.prepare<
            { in_app: number | null; email: number | null; push: number | null },
            [number, string]
          >(
            "SELECT in_app, email, push FROM notification_preferences WHERE user_id = ?1 AND type = ?2",
          ),
        ).get(userId, item.type);
        stmt.run(
          userId,
          item.type,
          item.inApp === undefined
            ? (old?.in_app ?? null)
            : item.inApp === null
              ? null
              : Number(item.inApp),
          item.email === undefined
            ? (old?.email ?? null)
            : item.email === null
              ? null
              : Number(item.email),
          item.push === undefined
            ? (old?.push ?? null)
            : item.push === null
              ? null
              : Number(item.push),
        );
      }
      return { ok: true as const };
    });
  },
);

export const announcementsCreateOp = implement(
  contracts.announcementsCreate,
  (ctx, actor, input) => {
    requirePermission(ctx, actor, "admin.announcements");
    const userId = requireAuthenticated(actor).userId;
    const html = renderMarkdown(input.body);
    return writeTx(ctx, () => {
      const id = Number(
        prepared(ctx, "notifications.insertAnnouncement", () =>
          ctx.sqlite.prepare<unknown, [number, string, string, string, number]>(
            "INSERT INTO announcements (user_id, title, body_source, body_html, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
          ),
        ).run(userId, input.title, input.body, html, ctx.now()).lastInsertRowid,
      );
      publishEvent(ctx, {
        type: "announcement.published",
        targetType: "announcement",
        targetId: id,
        payload: { userId },
      });
      return { id };
    });
  },
);

export const operations = [
  notificationsListOp,
  notificationsMarkReadOp,
  notificationsTypesOp,
  notificationsPreferencesOp,
  notificationsSetPreferencesOp,
  announcementsCreateOp,
];
export { purgeReadNotifications, registerNotificationJobs } from "./delivery";
