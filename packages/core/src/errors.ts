/**
 * Typed errors thrown by services. Adapters map `code` to transport errors
 * (REST status + envelope, MCP tool error); nothing in core knows about HTTP.
 *
 * Rule: if the actor may not even see a resource, throw NotFoundError (do not leak existence).
 * If they can see it but may not perform the action, throw ForbiddenError.
 */
export type ErrorCode = "validation" | "unauthenticated" | "forbidden" | "not_found" | "conflict";

export interface ErrorIssue {
  path: (string | number)[];
  message: string;
}

export class SermoError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly issues?: ErrorIssue[],
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends SermoError {
  constructor(message: string, issues?: ErrorIssue[]) {
    super("validation", message, issues);
  }
}

export class UnauthenticatedError extends SermoError {
  constructor(message = "You must be signed in to do that.") {
    super("unauthenticated", message);
  }
}

export class ForbiddenError extends SermoError {
  constructor(message = "You do not have permission to do that.") {
    super("forbidden", message);
  }
}

export class NotFoundError extends SermoError {
  constructor(message = "The requested item could not be found.") {
    super("not_found", message);
  }
}

export class ConflictError extends SermoError {
  constructor(message: string) {
    super("conflict", message);
  }
}
