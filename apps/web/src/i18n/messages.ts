// File = zone = one lower-case namespace. Second level: the camelCase component
// or page filename; at most one further group. Use role-based camelCase leaves,
// errors.* and aria.*. Bind zone.component once; count nouns use one ICU plural
// with `count`, and rich sentences use one message with tags. Keep strings in the
// rendering file's zone (no common namespace).
// The English catalogue is the source of the types. Every other language has the same files under
// messages/<locale>/ (a test holds them to the same keys, arguments and tags).
import type { Locale } from "@/i18n/locales";
import account from "../../messages/en/account.json";
import admin from "../../messages/en/admin.json";
import adminAppearance from "../../messages/en/admin-appearance.json";
import adminCommunication from "../../messages/en/admin-communication.json";
import adminContent from "../../messages/en/admin-content.json";
import adminEconomy from "../../messages/en/admin-economy.json";
import adminForums from "../../messages/en/admin-forums.json";
import adminGroups from "../../messages/en/admin-groups.json";
import adminSetup from "../../messages/en/admin-setup.json";
import adminTools from "../../messages/en/admin-tools.json";
import adminUsers from "../../messages/en/admin-users.json";
import auth from "../../messages/en/auth.json";
import awards from "../../messages/en/awards.json";
import conversations from "../../messages/en/conversations.json";
import credits from "../../messages/en/credits.json";
import editor from "../../messages/en/editor.json";
import forum from "../../messages/en/forum.json";
import forums from "../../messages/en/forums.json";
import home from "../../messages/en/home.json";
import layout from "../../messages/en/layout.json";
import lib from "../../messages/en/lib.json";
import lite from "../../messages/en/lite.json";
import members from "../../messages/en/members.json";
import moderation from "../../messages/en/moderation.json";
import notifications from "../../messages/en/notifications.json";
import search from "../../messages/en/search.json";
import skeletons from "../../messages/en/skeletons.json";
import staticMessages from "../../messages/en/static.json";
import threads from "../../messages/en/threads.json";
import ui from "../../messages/en/ui.json";
import upgrade from "../../messages/en/upgrade.json";

export const messages = {
  account,
  admin,
  adminAppearance,
  adminEconomy,
  adminForums,
  adminCommunication,
  adminContent,
  adminGroups,
  adminSetup,
  adminTools,
  adminUsers,
  auth,
  awards,
  conversations,
  credits,
  editor,
  forum,
  forums,
  home,
  layout,
  lib,
  lite,
  members,
  moderation,
  notifications,
  search,
  skeletons,
  static: staticMessages,
  threads,
  ui,
  upgrade,
};

export type Messages = typeof messages;

// The file of each top-level namespace.
const FILES: Record<keyof Messages, string> = {
  account: "account",
  admin: "admin",
  adminAppearance: "admin-appearance",
  adminEconomy: "admin-economy",
  adminForums: "admin-forums",
  adminCommunication: "admin-communication",
  adminContent: "admin-content",
  adminGroups: "admin-groups",
  adminSetup: "admin-setup",
  adminTools: "admin-tools",
  adminUsers: "admin-users",
  auth: "auth",
  awards: "awards",
  conversations: "conversations",
  credits: "credits",
  editor: "editor",
  forum: "forum",
  forums: "forums",
  home: "home",
  layout: "layout",
  lib: "lib",
  lite: "lite",
  members: "members",
  moderation: "moderation",
  notifications: "notifications",
  search: "search",
  skeletons: "skeletons",
  static: "static",
  threads: "threads",
  ui: "ui",
  upgrade: "upgrade",
};

// The catalogue of one language, loaded when asked for: only the active language reaches the
// client provider.
export async function messagesFor(locale: Locale): Promise<Messages> {
  const entries = await Promise.all(
    Object.entries(FILES).map(async ([key, file]) => {
      const loaded = await import(`../../messages/${locale}/${file}.json`);
      return [key, loaded.default] as const;
    }),
  );
  return Object.fromEntries(entries) as Messages;
}
