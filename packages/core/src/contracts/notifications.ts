/**
 * Notifications. Routes: GET /notifications (notifications.list), PUT /notifications/read
 * (notifications.markRead), GET /notifications/preferences (notifications.preferences),
 * PUT /notifications/preferences (notifications.setPreferences), GET /notifications/types
 * (notifications.types), POST /announcements (announcements.create).
 */
import * as z from "zod";
import { defineContract } from "../operation";
import { Body, Id, Ok, Page, pageInput, Timestamp, Title, UserSummary } from "./common";

export const Notification = z
  .object({
    id: Id,
    /** A type id from notifications.types. */
    type: z.string(),
    contentType: z.string(),
    contentId: Id,
    threadId: Id.nullable(),
    /** Most recent actors, newest first (several for grouped notifications such as reactions). */
    actors: z.array(UserSummary),
    actorCount: z.number().int().nonnegative(),
    /** Title of the content (thread title, conversation title...), when it has one. */
    contentTitle: z.string().nullable(),
    /** Canonical path of the content. */
    url: z.string(),
    /** Type-specific details: reason and message of a moderation action, reaction type... */
    data: z.record(z.string(), z.unknown()),
    createdAt: Timestamp,
    updatedAt: Timestamp,
    read: z.boolean(),
  })
  .meta({ id: "Notification" });

export const notificationsList = defineContract({
  name: "notifications.list",
  summary:
    "Your notifications, most recently updated first, optionally unread only, with your unread " +
    "count. Requires notification.view.",
  kind: "read",
  input: z.object({ unreadOnly: z.boolean().default(false), ...pageInput }),
  output: Page(Notification).extend({ unreadCount: z.number().int().nonnegative() }),
});

export const notificationsMarkRead = defineContract({
  name: "notifications.markRead",
  summary: "Mark some of your notifications read (ids), or all of them (all: true).",
  kind: "write",
  input: z.object({
    ids: z.array(Id).min(1).max(100).optional(),
    all: z.boolean().default(false),
  }),
  output: z.object({ unreadCount: z.number().int().nonnegative() }),
});

export const ChannelPreference = z
  .object({ inApp: z.boolean(), email: z.boolean(), push: z.boolean() })
  .meta({ id: "ChannelPreference" });

export const NotificationType = z
  .object({
    id: z.string(),
    /** Phrase keys. */
    label: z.string(),
    description: z.string(),
    defaults: ChannelPreference,
    /** Members cannot turn it off (security messages). */
    required: z.boolean(),
    /** Channels this type can use. */
    channels: z.array(z.enum(["inApp", "email", "push"])),
  })
  .meta({ id: "NotificationType" });

export const notificationsTypes = defineContract({
  name: "notifications.types",
  summary: "Every notification type with its default channels (registry plus admin defaults).",
  kind: "read",
  input: z.object({}),
  output: z.object({ items: z.array(NotificationType) }),
});

export const notificationsPreferences = defineContract({
  name: "notifications.preferences",
  summary: "Your channel choice for every notification type (defaults where you set none).",
  kind: "read",
  input: z.object({}),
  output: z.object({
    items: z.array(z.object({ type: z.string() }).extend(ChannelPreference.shape)),
  }),
});

export const notificationsSetPreferences = defineContract({
  name: "notifications.setPreferences",
  summary:
    "Set your channels for some notification types; null resets a channel to the default. " +
    "Required types cannot be turned off.",
  kind: "write",
  input: z.object({
    items: z
      .array(
        z.object({
          type: z.string(),
          inApp: z.boolean().nullable().optional(),
          email: z.boolean().nullable().optional(),
          push: z.boolean().nullable().optional(),
        }),
      )
      .min(1)
      .max(100),
  }),
  output: Ok,
});

export const announcementsCreate = defineContract({
  name: "announcements.create",
  summary:
    "Send an announcement to every member as a notification (delivered in the background). " +
    "Requires admin.announcements.",
  kind: "write",
  input: z.object({ title: Title, body: Body }),
  output: z.object({ id: Id }),
});

export const notificationsUnsubscribe = defineContract({
  name: "notifications.unsubscribe",
  summary:
    "One-click unsubscribe from a signed email link, without signing in: turns off email for " +
    "the type in the token, or for every type. The token is the authorization.",
  kind: "write",
  input: z.object({ token: z.string().min(16).max(1000) }),
  output: z.object({ scope: z.string() }),
});

export const pushSubscribe = defineContract({
  name: "push.subscribe",
  summary: "Store a Web Push subscription for this device. Signed-in members.",
  kind: "write",
  input: z.object({
    endpoint: z.url().max(2000),
    keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
    userAgent: z.string().max(500).default(""),
  }),
  output: Ok,
});

export const pushUnsubscribe = defineContract({
  name: "push.unsubscribe",
  summary: "Remove one of your Web Push subscriptions.",
  kind: "write",
  input: z.object({ endpoint: z.url().max(2000) }),
  output: Ok,
});

export const pushPublicKey = defineContract({
  name: "push.publicKey",
  summary: "The VAPID public key for subscribing, or null when push is disabled.",
  kind: "read",
  input: z.object({}),
  output: z.object({ publicKey: z.string().nullable() }),
});
