import type * as z from "zod";
import { ValidationError } from "./errors";

/** Opaque keyset cursor: base64url-encoded JSON array of the sort key of the last item. */
export function encodeCursor(values: readonly (string | number)[]): string {
  return Buffer.from(JSON.stringify(values)).toString("base64url");
}

/** Decodes a cursor produced by encodeCursor; throws ValidationError if it is malformed. */
export function decodeCursor<T extends z.ZodType>(cursor: string, schema: T): z.output<T> {
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    throw invalidCursor();
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw invalidCursor();
  return parsed.data;
}

function invalidCursor(): ValidationError {
  return new ValidationError("Invalid cursor.", [{ path: ["cursor"], message: "Invalid cursor." }]);
}
