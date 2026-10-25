const RATE_LIMITED = "rate_limited";
export const RATE_LIMITED_DIGEST = "sermo.rate_limited";
export const APPROVAL_PENDING_DIGEST = "sermo.approval_pending";
// The issue path of the refusal an account waiting for approval gets: the contracts'
// APPROVAL_PENDING_PATH, written out because this file reaches the browser and the contracts
// must not (a test holds the two equal).
export const APPROVAL_ISSUE_PATH = "approval";
// The issue path of the +18 refusal (the contracts' ADULT_REFUSAL_PATH, written out for the same
// reason), and why the viewer may not see the content: the issue's message.
export const ADULT_ISSUE_PATH = "adult";
export const ADULT_REASONS = [
  "guest",
  "minor",
  "birthDate",
  "acceptance",
] as const;
export type AdultReason = (typeof ADULT_REASONS)[number];
// The digest of a +18 refusal is this prefix and the reason, so the error screen can draw the
// +18 page or the warning window without the message, which stays on the server.
const ADULT_DIGEST_PREFIX = "sermo.adult.";

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
    const adult = adultReasonOf(code, issues);
    if (code === RATE_LIMITED) this.digest = RATE_LIMITED_DIGEST;
    else if (adult) this.digest = `${ADULT_DIGEST_PREFIX}${adult}`;
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

// Why the backend refused +18 content: a refusal (forbidden) whose issue names the `adult` path
// and the reason as its message; null for any other answer.
function adultReasonOf(
  code: string,
  issues: SermoIssue[] | undefined,
): AdultReason | null {
  if (code !== "forbidden") return null;
  for (const issue of issues ?? []) {
    if (!Array.isArray(issue.path) || issue.path[0] !== ADULT_ISSUE_PATH)
      continue;
    const reason = ADULT_REASONS.find((known) => known === issue.message);
    if (reason) return reason;
  }
  return null;
}

// The reason a page's error carries in its digest when it is the +18 refusal, else null.
export function adultReasonOfDigest(
  digest: string | undefined,
): AdultReason | null {
  if (!digest?.startsWith(ADULT_DIGEST_PREFIX)) return null;
  const reason = digest.slice(ADULT_DIGEST_PREFIX.length);
  return ADULT_REASONS.find((known) => known === reason) ?? null;
}

// The backend refuses the session itself: the cookie is dead (unauthenticated) or the account is
// banned (forbidden on auth.me). Either way the visitor is shown the site as a guest.
export function isSignedOut(error: SermoError): boolean {
  return error.code === "unauthenticated" || error.code === "forbidden";
}
