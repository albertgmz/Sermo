import type { AnyOperation } from "../../operation";
import { adminActivityOp, adminJobsOp, adminStaffOnlineOp } from "./home";
import { staffAdministratorsOp, staffModeratorsOp } from "./rosters";

export const operations: AnyOperation[] = [
  adminActivityOp,
  adminStaffOnlineOp,
  adminJobsOp,
  staffModeratorsOp,
  staffAdministratorsOp,
];
