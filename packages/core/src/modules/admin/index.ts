import type { AnyOperation } from "../../operation";
import { usersAdminEraseOp } from "./erase";
import { adminActivityOp, adminJobsOp, adminStaffOnlineOp } from "./home";
import { authVerifyPasswordOp, usersAdminUpdateIdentityOp } from "./identity";
import { usersAdminGetOp, usersAdminListOp } from "./members";
import { usersAdminUpdateProfileOp } from "./profile";
import { staffAdministratorsOp, staffModeratorsOp } from "./rosters";
import { announcementsListOp, approvalsViewConversationMessageOp, bansListOp } from "./sanctions";
import { usersAdminLogOp, usersAdminRevokeSessionsOp, usersAdminSessionsOp } from "./sessions";

export const operations: AnyOperation[] = [
  adminActivityOp,
  adminStaffOnlineOp,
  adminJobsOp,
  staffModeratorsOp,
  staffAdministratorsOp,
  usersAdminListOp,
  usersAdminGetOp,
  authVerifyPasswordOp,
  usersAdminUpdateIdentityOp,
  usersAdminUpdateProfileOp,
  usersAdminSessionsOp,
  usersAdminRevokeSessionsOp,
  usersAdminLogOp,
  usersAdminEraseOp,
  bansListOp,
  announcementsListOp,
  approvalsViewConversationMessageOp,
];
