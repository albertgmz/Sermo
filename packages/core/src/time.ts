/** Converts stored epoch milliseconds to the ISO 8601 strings used in every contract. */
export function iso(ms: number): string {
  return new Date(ms).toISOString();
}

export function isoOrNull(ms: number | null | undefined): string | null {
  return ms == null ? null : new Date(ms).toISOString();
}
