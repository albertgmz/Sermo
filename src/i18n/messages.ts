// File = zone = one lower-case namespace. Second level: the camelCase component
// or page filename; at most one further group. Use role-based camelCase leaves,
// errors.* and aria.*. Bind zone.component once; count nouns use one ICU plural
// with `count`, and rich sentences use one message with tags. Keep strings in the
// rendering file's zone (no common namespace); keep forum/ui literal in messages.
import account from "../../messages/en/account.json";
import admin from "../../messages/en/admin.json";
import auth from "../../messages/en/auth.json";
import awards from "../../messages/en/awards.json";
import conversations from "../../messages/en/conversations.json";
import credits from "../../messages/en/credits.json";
import forum from "../../messages/en/forum.json";
import forums from "../../messages/en/forums.json";
import home from "../../messages/en/home.json";
import layout from "../../messages/en/layout.json";
import lib from "../../messages/en/lib.json";
import members from "../../messages/en/members.json";
import notifications from "../../messages/en/notifications.json";
import search from "../../messages/en/search.json";
import staticMessages from "../../messages/en/static.json";
import threads from "../../messages/en/threads.json";
import ui from "../../messages/en/ui.json";
import upgrade from "../../messages/en/upgrade.json";

export const messages = {
  account,
  admin,
  auth,
  awards,
  conversations,
  credits,
  forum,
  forums,
  home,
  layout,
  lib,
  members,
  notifications,
  search,
  static: staticMessages,
  threads,
  ui,
  upgrade,
};
