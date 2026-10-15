// What the viewer may do when rejecting a sign-up, from the permissions they hold: erasing the
// account needs `admin.members`, banning needs `member.ban` and is bounded by `member.banMaxDays`
// (-1 allows a ban for good, 0 none; a group that sets no value gives 30). The backend decides
// again for every account; this only keeps the form from offering what it would refuse.

import type { Standing } from "../../registry";

export type RejectOptions = {
  // The account may be erased.
  erase: boolean;
  // The account may be banned: whether for good is allowed and the most days (null: no ban).
  ban: { forever: boolean; maxDays: number } | null;
};

// The longest ban the backend takes.
const MAX_DAYS = 3650;
const DEFAULT_MAX_DAYS = 30;

export function rejectOptions(viewer: Standing): RejectOptions {
  const held = viewer.resolvedPermissions;
  const bound = held["member.banMaxDays"];
  const limit = typeof bound === "number" ? bound : DEFAULT_MAX_DAYS;
  const forever = limit === -1;
  const maxDays = forever ? MAX_DAYS : Math.min(limit, MAX_DAYS);
  return {
    erase: held["admin.members"] === true,
    ban:
      held["member.ban"] === true && (forever || maxDays >= 1)
        ? { forever, maxDays }
        : null,
  };
}
