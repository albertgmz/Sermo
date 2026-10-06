import webPush from "web-push";
import type { Actor } from "../../actor";
import { type Ctx, prepared } from "../../context";
import { writeTx } from "../../db/tx";
import { ForbiddenError, NotFoundError } from "../../errors";
import {
  can,
  currentVersions,
  memberActor,
  PRINCIPAL_COLUMNS,
  type PrincipalRow,
} from "../../permissions";
import { renderPlainText } from "../../render";
import { registerJobHandler } from "../jobs/queue";
import { mayViewProfile, requireComment, requirePost } from "../profiles/shared";
import { canonicalUrl } from "../seo/paths";
import { readSiteSettings } from "../settings";
import {
  allowedPushEndpoint,
  markPushJobsRegistered,
  pushJobsReady,
  pushTransport,
  pushVapid,
} from "./config";

export interface PushItem {
  notificationId: number;
  userId: number;
  type: string;
  contentType: string;
  contentId: number;
  threadId: number | null;
  actorId: number | null;
  data: Record<string, unknown>;
}

export type PushDefaults = Record<string, { inApp: boolean; email: boolean; push: boolean }>;
export type PushPhrase = {
  title: string;
  bodyHtml: string;
  /** Required for a conversation phrase containing message text. */
  bodyWithoutContentHtml?: string;
};
export type PushPhraseRenderer = (item: PushItem, language: string) => PushPhrase;

export function pushPayload(
  item: PushItem,
  phrase: PushPhrase,
  url: string,
  includeConversationBody: boolean,
): { title: string; body: string; url: string } {
  const bodyHtml =
    item.contentType.startsWith("conversation") && !includeConversationBody
      ? (phrase.bodyWithoutContentHtml ?? phrase.title)
      : phrase.bodyHtml;
  return { title: phrase.title.slice(0, 120), body: renderPlainText(bodyHtml, 180), url };
}

type Recipient = PrincipalRow & { group_id: number; language: string | null };
type Subscription = { id: number; endpoint: string; p256dh: string; auth: string };
type Content = { url: string };

function query<Row, Params extends (string | number | null)[]>(ctx: Ctx, key: string, sql: string) {
  return prepared(ctx, `push.${key}`, () => ctx.sqlite.prepare<Row, Params>(sql));
}

function recipient(ctx: Ctx, userId: number): { actor: Actor; language: string | null } | null {
  const row = query<Recipient, [number]>(
    ctx,
    "recipient",
    `SELECT u.group_id, u.language, ${PRINCIPAL_COLUMNS} FROM users u WHERE u.id = ?1`,
  ).get(userId);
  return row
    ? {
        actor: memberActor(userId, row.group_id, row, currentVersions(ctx)),
        language: row.language,
      }
    : null;
}

function enabled(ctx: Ctx, item: PushItem, fallback: boolean): boolean {
  const preference = query<{ push: number | null }, [number, string]>(
    ctx,
    "preference",
    "SELECT push FROM notification_preferences WHERE user_id = ?1 AND type = ?2",
  ).get(item.userId, item.type);
  return Boolean(
    preference?.push ?? readSiteSettings(ctx).notificationDefaults[item.type]?.push ?? fallback,
  );
}

function stateVisible(ctx: Ctx, actor: Actor, state: string, ownerId: number, nodeId: number) {
  if (state === "visible") return true;
  if (state === "moderated")
    return (
      (actor.kind !== "guest" && actor.userId === ownerId) ||
      can(ctx, actor, "forum.viewModerated", { nodeId })
    );
  return state === "deleted" && can(ctx, actor, "forum.viewDeleted", { nodeId });
}

/** The wall owner of a profile post or comment the recipient may see, as the profile pages decide. */
function visibleProfileOwner(ctx: Ctx, actor: Actor, item: PushItem): number | null {
  try {
    return item.contentType === "profile_post"
      ? requirePost(ctx, actor, item.contentId).profile_user_id
      : requireComment(ctx, actor, item.contentId).post.profile_user_id;
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof ForbiddenError) return null;
    throw error;
  }
}

function visibleContent(ctx: Ctx, actor: Actor, item: PushItem): Content | null {
  const base = ctx.config.siteBaseURL ?? ctx.config.auth?.baseURL ?? "http://localhost:3000";
  if (item.contentType === "thread" || item.contentType === "post") {
    const row =
      item.contentType === "thread"
        ? query<
            {
              id: number;
              title: string;
              node_id: number;
              user_id: number;
              state: string;
              post_state: string | null;
              post_user_id: number | null;
            },
            [number]
          >(
            ctx,
            "threadContent",
            "SELECT id,title,node_id,user_id,state,NULL AS post_state,NULL AS post_user_id FROM threads WHERE id = ?1",
          ).get(item.contentId)
        : query<
            {
              id: number;
              title: string;
              node_id: number;
              user_id: number;
              state: string;
              post_state: string | null;
              post_user_id: number | null;
            },
            [number]
          >(
            ctx,
            "postContent",
            "SELECT t.id,t.title,t.node_id,t.user_id,t.state,p.state AS post_state,p.user_id AS post_user_id FROM posts p JOIN threads t ON t.id=p.thread_id WHERE p.id = ?1",
          ).get(item.contentId);
    if (!row || !can(ctx, actor, "node.view", { nodeId: row.node_id })) return null;
    if (!stateVisible(ctx, actor, row.state, row.user_id, row.node_id)) return null;
    if (row.post_state && !stateVisible(ctx, actor, row.post_state, row.post_user_id!, row.node_id))
      return null;
    const url = canonicalUrl(base, "thread", row.id, row.title);
    return { url: item.contentType === "post" ? `${url}#post-${item.contentId}` : url };
  }
  if (item.contentType === "conversation" || item.contentType === "conversation_message") {
    const conversationId =
      item.contentType === "conversation"
        ? item.contentId
        : query<{ conversation_id: number; state: string; user_id: number }, [number]>(
            ctx,
            "messageContent",
            "SELECT conversation_id,state,user_id FROM conversation_messages WHERE id = ?1",
          ).get(item.contentId)?.conversation_id;
    if (!conversationId) return null;
    const participant = query<{ state: string }, [number, number]>(
      ctx,
      "participant",
      "SELECT state FROM conversation_participants WHERE conversation_id = ?1 AND user_id = ?2",
    ).get(conversationId, item.userId);
    if (participant?.state !== "active") return null;
    if (item.contentType === "conversation_message") {
      const message = query<{ state: string; user_id: number }, [number]>(
        ctx,
        "messageState",
        "SELECT state,user_id FROM conversation_messages WHERE id = ?1",
      ).get(item.contentId);
      if (
        !message ||
        (message.state !== "visible" &&
          !(message.state === "moderated" && message.user_id === item.userId) &&
          !can(ctx, actor, "conversation.viewHidden"))
      )
        return null;
    }
    return { url: new URL(`/conversations/${conversationId}`, base).href };
  }
  if (item.contentType === "profile_post" || item.contentType === "profile_post_comment") {
    const profileUserId = visibleProfileOwner(ctx, actor, item);
    if (profileUserId === null) return null;
    const owner = query<{ username: string }, [number]>(
      ctx,
      "profileOwner",
      "SELECT username FROM users WHERE id = ?1",
    ).get(profileUserId);
    if (!owner) return null;
    return {
      url: `${canonicalUrl(base, "profile", profileUserId, owner.username)}#${item.contentType === "profile_post" ? "profile-post" : "profile-comment"}-${item.contentId}`,
    };
  }
  if (item.contentType === "user" || item.contentType === "profile") {
    if (!can(ctx, actor, "profile.view")) return null;
    const row = query<{ username: string }, [number]>(
      ctx,
      "profileContent",
      "SELECT username FROM users WHERE id = ?1",
    ).get(item.contentId);
    return row && mayViewProfile(ctx, actor, item.contentId)
      ? { url: canonicalUrl(base, "profile", item.contentId, row.username) }
      : null;
  }
  return null;
}

/** Called synchronously by notification creation, including inside its transaction. */
export function deliverPush(ctx: Ctx, items: PushItem[], defaults: PushDefaults): void {
  if (!pushJobsReady(ctx) || !items.length) return;
  const adminDefaults = readSiteSettings(ctx).notificationDefaults;
  const payload = JSON.stringify(
    items.map((item) => ({
      item,
      defaultPush: Number(adminDefaults[item.type]?.push ?? defaults[item.type]?.push ?? false),
    })),
  );
  writeTx(ctx, () => {
    query(
      ctx,
      "queueBatch",
      "INSERT INTO jobs (type,payload,run_at,unique_key,created_at,updated_at) " +
        "SELECT 'push.send',json_object('item',json(json_extract(j.value,'$.item')),'subscriptionId',s.id,'defaultPush',json_extract(j.value,'$.defaultPush')),?2, " +
        "'push.notification.' || json_extract(j.value,'$.item.notificationId') || '.subscription.' || s.id,?2,?2 " +
        "FROM json_each(?1) j JOIN push_subscriptions s ON s.user_id = json_extract(j.value,'$.item.userId') " +
        "JOIN notifications n ON n.id = json_extract(j.value,'$.item.notificationId') AND n.user_id = s.user_id " +
        "LEFT JOIN notification_preferences p ON p.user_id = s.user_id AND p.type = json_extract(j.value,'$.item.type') " +
        "WHERE COALESCE(p.push,json_extract(j.value,'$.defaultPush')) = 1 ON CONFLICT(unique_key) DO NOTHING",
    ).run(payload, ctx.now());
  });
}

export function registerPushJobs(ctx: Ctx, options: { renderPhrase: PushPhraseRenderer }): void {
  registerJobHandler(ctx, "push.send", async (_ctx, raw) => {
    const vapid = pushVapid(ctx);
    if (!vapid) return;
    const payload = raw as { item: PushItem; subscriptionId: number; defaultPush: boolean };
    const item = payload.item;
    const notification = query<{ id: number }, [number, number]>(
      ctx,
      "notification",
      "SELECT id FROM notifications WHERE id = ?1 AND user_id = ?2",
    ).get(item.notificationId, item.userId);
    if (!notification || !enabled(ctx, item, payload.defaultPush)) return;
    const member = recipient(ctx, item.userId);
    if (!member) return;
    const content = visibleContent(ctx, member.actor, item);
    if (!content) return;
    const settings = readSiteSettings(ctx);
    const phrase = options.renderPhrase(item, member.language ?? settings.defaultLanguage);
    const message = JSON.stringify(
      pushPayload(item, phrase, content.url, settings.conversationEmailIncludesBody),
    );
    const subscription = query<Subscription, [number, number]>(
      ctx,
      "subscription",
      "SELECT id,endpoint,p256dh,auth FROM push_subscriptions WHERE id = ?1 AND user_id = ?2",
    ).get(payload.subscriptionId, item.userId);
    if (!subscription) return;
    const remove = () =>
      writeTx(ctx, () => {
        query(
          ctx,
          "removeExpired",
          "DELETE FROM push_subscriptions WHERE id = ?1 AND endpoint = ?2",
        ).run(subscription.id, subscription.endpoint);
      });
    if (allowedPushEndpoint(ctx, subscription.endpoint) !== subscription.endpoint) {
      remove();
      return;
    }
    // Request-building failures (a bad stored key) never succeed on retry.
    let request: ReturnType<typeof webPush.generateRequestDetails>;
    try {
      request = webPush.generateRequestDetails(
        {
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth },
        },
        message,
        { vapidDetails: vapid, TTL: 3600, contentEncoding: "aes128gcm" },
      );
    } catch (error) {
      console.warn("[push.send] cannot build the request for the subscription", {
        subscriptionId: subscription.id,
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    // The deadline covers connect, TLS and response headers. A timeout or network error throws,
    // and the queue retries the job.
    const transport = pushTransport(ctx);
    const signal = AbortSignal.timeout(transport.timeoutMs);
    const response = await fetch(request.endpoint, {
      method: request.method,
      headers: Object.fromEntries(
        Object.entries(request.headers).map(([name, value]) => [name, String(value)]),
      ),
      body: request.body && new Uint8Array(request.body),
      redirect: "manual",
      signal,
      tls: transport.ca ? { ca: transport.ca } : undefined,
    });
    await response.body?.cancel();
    const status = response.status;
    if (status >= 200 && status <= 299) return;
    // Only 404/410 mean the subscription is gone; 403 usually means our VAPID credentials are
    // wrong, and deleting on it would wipe every subscriber after one misconfiguration.
    if (status === 404 || status === 410) remove();
    else if (
      (status >= 300 && status <= 399) ||
      status === 400 ||
      status === 403 ||
      status === 413
    ) {
      console.warn("[push.send] permanent delivery failure", {
        subscriptionId: subscription.id,
        status,
      });
    } else throw new Error(`Push service responded ${status}.`);
  });
  markPushJobsRegistered(ctx);
}
