import { ForbiddenError } from "./errors";

/*
 * The refusal an account that waits in the sign-up queue gets for anything but reading. It lives
 * outside the contracts because both the permission check and `execute` raise it.
 */

/** The `path` of the issue that marks a refusal as "this account waits for approval". */
export const APPROVAL_PENDING_PATH = "approval";

/** The message of that refusal. */
export const APPROVAL_PENDING_MESSAGE = "Your account is waiting for staff to approve it.";

export const approvalPending = (): ForbiddenError =>
  new ForbiddenError(APPROVAL_PENDING_MESSAGE, [
    { path: [APPROVAL_PENDING_PATH], message: "awaiting" },
  ]);
