import type { AnyOperation } from "../../operation";
import { usersAdminAcceptancesOp } from "./acceptances";
import { usersBatchPreviewOp, usersBatchUpdateOp } from "./batch";
import { usersDeleteOwnAccountOp } from "./delete-own-account";
import { usersAdminEraseOp } from "./erase";
import { adminActivityOp, adminJobsOp, adminStaffOnlineOp } from "./home";
import { authVerifyPasswordOp, usersAdminUpdateIdentityOp } from "./identity";
import { usersAdminGetOp, usersAdminListOp } from "./members";
import { usersAdminUpdateProfileOp } from "./profile";
import { staffAdministratorsOp, staffModeratorsOp } from "./rosters";
import { announcementsListOp, approvalsViewConversationMessageOp, bansListOp } from "./sanctions";
import { usersAdminLogOp, usersAdminRevokeSessionsOp, usersAdminSessionsOp } from "./sessions";
import { signupsDecideOp, signupsListOp } from "./signups";
import { usersSetSuperAdminOp } from "./super-admin";

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
  usersAdminAcceptancesOp,
  usersAdminEraseOp,
  usersDeleteOwnAccountOp,
  usersSetSuperAdminOp,
  usersBatchPreviewOp,
  usersBatchUpdateOp,
  signupsListOp,
  signupsDecideOp,
  bansListOp,
  announcementsListOp,
  approvalsViewConversationMessageOp,
];
