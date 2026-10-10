import type { EventType } from "../../events";

export interface NotificationDefinition {
  id: string;
  events: readonly EventType[];
  recipient: string;
  group: "reaction" | "thread" | null;
  defaults: { inApp: boolean; email: boolean; push: boolean };
  required: boolean;
  title: string;
  body: string;
}

const regular = { inApp: true, email: false, push: false };
const entry = (
  id: string,
  events: readonly EventType[],
  recipient: string,
  group: NotificationDefinition["group"] = null,
  required = false,
): NotificationDefinition => ({
  id,
  events,
  recipient,
  group,
  defaults: required ? { inApp: false, email: true, push: false } : regular,
  required,
  title: `notification.${id}.title`,
  body: `notification.${id}.body`,
});

export const notificationTypes: readonly NotificationDefinition[] = [
  entry("thread.watched", ["content.created", "content.state_changed"], "thread watcher", "thread"),
  entry("node.thread", ["content.created", "content.state_changed"], "node watcher"),
  entry("node.post", ["content.created", "content.state_changed"], "node watcher"),
  entry("content.quoted", ["content.created", "content.state_changed"], "quoted author"),
  entry(
    "content.mentioned",
    ["content.created", "content.edited", "content.state_changed"],
    "mentioned member",
  ),
  entry("content.reaction", ["reaction.added"], "content author", "reaction"),
  entry("profile.post", ["content.created", "content.state_changed"], "profile owner"),
  entry("profile.comment", ["content.created", "content.state_changed"], "profile post author"),
  entry("profile.commented", ["content.created", "content.state_changed"], "previous commenter"),
  entry("member.thread", ["content.created", "content.state_changed"], "follower"),
  entry("member.followed", ["member.followed"], "followed member"),
  entry("conversation.added", ["conversation.participants_added"], "added participant"),
  entry("conversation.message", ["content.created", "content.state_changed"], "participant"),
  entry(
    "moderation.content",
    ["content.deleted", "content.edited", "content.state_changed", "moderation.action"],
    "content author",
  ),
  entry(
    "moderation.member",
    ["member.warned", "member.banned", "member.restricted", "member.thread_banned"],
    "affected member",
  ),
  entry("report.resolved", ["report.state_changed"], "reporter"),
  entry("moderator.report", ["report.created"], "moderator"),
  entry("moderator.approval", ["content.created"], "moderator"),
  entry("member.groups", ["member.groups_changed"], "affected member"),
  entry("announcement", ["announcement.published"], "every member"),
  entry("account.security", [], "account owner", null, true),
];

export const typeById = new Map(notificationTypes.map((type) => [type.id, type]));

/**
 * The channel registry the email and push modules expect. Required types are security mail
 * (never opt-out, never capped); watch types email only when the member's watch asks for email.
 */
export const notificationChannels = {
  defaults: Object.fromEntries(notificationTypes.map((type) => [type.id, type.defaults])),
  securityTypes: new Set(notificationTypes.filter((type) => type.required).map((type) => type.id)),
  watchTypes: new Set(["thread.watched", "node.thread", "node.post"]),
};
