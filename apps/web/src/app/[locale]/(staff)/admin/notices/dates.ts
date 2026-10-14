// The date-time fields of a notice are in UTC, as the backend keeps them: a form value
// ("2026-03-01T09:30") has no zone of its own.

// A stored time as the value of a date-time field, or "" for none.
export const dateInput = (iso: string | null) =>
  iso === null ? "" : iso.slice(0, 16);

// The time a date-time field holds as the backend takes it: null for an empty field, undefined for
// text that is not a date.
export function dateValue(raw: string): string | null | undefined {
  if (raw === "") return null;
  const time = new Date(`${raw}Z`);
  return Number.isNaN(time.getTime()) ? undefined : time.toISOString();
}
