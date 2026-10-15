import { expect, test } from "bun:test";
import { messages } from "@/i18n/messages";
import { actionLabel } from "./action-label";

const labels = messages.admin.logTable.actions as Record<string, string>;
const names = Object.assign((key: string) => labels[key], {
  has: (key: string) => key in labels,
});

// Every action id the backend writes to the moderator log (`appendModeratorLog` and its callers).
const IDS = [
  "appearance.color.create",
  "appearance.color.update",
  "appearance.color.delete",
  "appearance.image.create",
  "appearance.image.update",
  "appearance.image.delete",
  "award.image",
  "ban.add",
  "ban.lift",
  "ban.threshold",
  "bulk.delete",
  "bulk.restore",
  "bulk.approve",
  "bulk.move",
  "bulk.lock",
  "bulk.unlock",
  "content.visible",
  "content.moderated",
  "content.deleted",
  "conversation_message.view",
  "forumTab.create",
  "forumTab.update",
  "forumTab.delete",
  "group.create",
  "group.update",
  "group.delete",
  "member.email",
  "member.erase",
  "member.identity.failed",
  "member.password",
  "member.passwordReset",
  "member.profile",
  "member.sessions.revoke",
  "member.username",
  "navigation.create",
  "navigation.update",
  "navigation.delete",
  "node.create",
  "node.update",
  "node.moderator.add",
  "node.moderator.remove",
  "node.node_icon",
  "node.node_cover",
  "page.save",
  "page.delete",
  "permission.set",
  "post.edit",
  "post.delete",
  "post.restore",
  "profile_comment.edit",
  "profile_comment.delete",
  "profile_comment.restore",
  "profile_post.edit",
  "profile_post.delete",
  "profile_post.restore",
  "reaction_type.create",
  "reaction_type.update",
  "report.open",
  "report.assigned",
  "report.resolved",
  "report.rejected",
  "restriction.add",
  "restriction.lift",
  "settings.update",
  "shop.item.image",
  "spam.cleanup.queued",
  "spam.cleanup.batch",
  "spam.cleanup.message",
  "spam.cleanup.skipped",
  "thread.update",
  "thread.delete",
  "thread.restore",
  "thread.lock",
  "thread.sticky",
  "thread.feature",
  "thread.move",
  "thread.merge",
  "thread.split",
  "thread.removeCover",
  "thread.transfer.failed",
  "threadPrefix.create",
  "threadPrefix.update",
  "threadPrefix.delete",
  "thread_ban.create",
  "thread_ban.lift",
  "user.groups",
  "user.superAdmin",
  "warning.add",
  "word_filter.upsert",
  "word_filter.remove",
];

test("every action id the backend writes has a readable label", () => {
  for (const id of IDS) {
    const label = actionLabel(names, id);
    expect(label, id).toBeString();
    expect(label, id).not.toBe(id);
  }
});

test("a label is stored under the id with underscores for dots", () => {
  expect(actionLabel(names, "node.moderator.add")).toBe(
    "Forum moderator added",
  );
  expect(actionLabel(names, "permission.set")).toBe("Permissions set");
});

test("an id with no label has none", () => {
  expect(actionLabel(names, "something.new")).toBeNull();
});

test("no label is kept for an id the backend does not write", () => {
  const known = new Set(IDS.map((id) => id.replaceAll(".", "_")));
  for (const key of Object.keys(labels)) expect(known.has(key), key).toBe(true);
});
