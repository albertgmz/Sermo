// What the server (not the browser) records about a signed-in member's actions, grouped for the
// privacy and cookie pages. The groups are drawn from the backend's own list of logged actions:
// `Record<IpLogAction, …>` stops compiling when the backend logs a new kind of action, so the
// pages cannot silently leave it out. The words are in `messages/<locale>/cookies.json` under
// `logged.items.<group>`.
import type { IP_LOG_ACTIONS } from "@sermo/core/contracts";

export type IpLogAction = (typeof IP_LOG_ACTIONS)[number];

export const LOGGED_GROUPS = ["signIns", "content", "reports"] as const;
export type LoggedGroup = (typeof LOGGED_GROUPS)[number];

export const GROUP_OF_ACTION: Record<IpLogAction, LoggedGroup> = {
  sign_in: "signIns",
  sign_in_failed: "signIns",
  register: "signIns",
  thread: "content",
  post: "content",
  conversation_message: "content",
  profile_post: "content",
  profile_post_comment: "content",
  report: "reports",
};
