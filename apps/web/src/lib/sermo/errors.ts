export type SermoIssue = { path?: unknown; message?: string };

export class SermoError extends Error {
  readonly code: string;
  readonly status: number;
  readonly issues?: SermoIssue[];

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
  }
}
