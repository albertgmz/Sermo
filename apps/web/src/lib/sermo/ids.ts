import { SermoError } from "./errors";

// A record is addressed by the backend's id: a positive integer written in plain decimal. `Number`
// alone would also take "0x10", "1e2" or " 7", which are other addresses for the same record.
export function parseId(raw: string): number | null {
  if (!/^[1-9]\d*$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) ? id : null;
}

// Whether a number that came from a client (an action's argument) can be a record id.
export const isRecordId = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 1;

// For actions: what a client sends as the id of a record is checked before it is put in a path.
export function requireIds(...ids: unknown[]): void {
  if (!ids.every(isRecordId)) {
    throw new SermoError("validation", 422, "Not a record id.");
  }
}
