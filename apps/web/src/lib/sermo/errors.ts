const RATE_LIMITED = "rate_limited";
export const RATE_LIMITED_DIGEST = "sermo.rate_limited";
export const APPROVAL_PENDING_DIGEST = "sermo.approval_pending";
// The issue path of the refusal an account waiting for approval gets: the contracts'
// APPROVAL_PENDING_PATH, written out because this file reaches the browser and the contracts
// must not (a test holds the two equal).
export const APPROVAL_ISSUE_PATH = "approval";

export type SermoIssue = { path?: unknown; message?: string };

export class SermoError extends Error {
  readonly code: string;
  readonly status: number;
  readonly issues?: SermoIssue[];
  // Next sends an error's digest to the error boundary and keeps the message back, so a throttled
  // visitor is told apart there by this value.
  readonly digest?: string;

  constructor(
    code: string,
    status: number,
    message: string,
    issues?: SermoIssue[],
  ) {
    super(message);
    this.name = "SermoError";
    this.code = code;
    this.status = status;
    this.issues = issues;
    if (code === RATE_LIMITED) this.digest = RATE_LIMITED_DIGEST;
    else if (
      code === "forbidden" &&
      issues?.some(
        (issue) =>
          Array.isArray(issue.path) && issue.path[0] === APPROVAL_ISSUE_PATH,
      )
    )
      this.digest = APPROVAL_PENDING_DIGEST;
  }
}

// The backend refuses the session itself: the cookie is dead (unauthenticated) or the account is
// banned (forbidden on auth.me). Either way the visitor is shown the site as a guest.
export function isSignedOut(error: SermoError): boolean {
  return error.code === "unauthenticated" || error.code === "forbidden";
}
