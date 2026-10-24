// A month as the value of a month field: `YYYY-MM`.
export const monthValue = (year: number, month: number) =>
  `${year}-${String(month).padStart(2, "0")}`;

// The months worth asking for, as `YYYY-MM`: from the oldest month with something to show (the last
// complete month, which keeps its whole standing, or the oldest winner on record) to the running
// one. `previous` is the last complete month: the oldest whose standing is kept.
export function pickableMonths(
  winners: readonly { year: number; month: number }[],
  now: Date,
) {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  const previous =
    month === 1 ? monthValue(year - 1, 12) : monthValue(year, month - 1);
  const oldest = winners.map((entry) => monthValue(entry.year, entry.month));
  return {
    min: [previous, ...oldest].sort()[0],
    max: monthValue(year, month),
    previous,
  };
}
