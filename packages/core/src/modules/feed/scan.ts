/** Rows one batch asks the database for. */
export const SCAN_BATCH = 40;
/** The most rows one request examines per source before it gives up and returns what it has. */
export const SCAN_CAP = 400;

/**
 * Walks a keyset-ordered source in bounded batches until `limit` rows pass the viewer's filter or
 * `cap` rows have been examined. `before` is the key the previous page ended at (null for the
 * first page). Returns the passing rows and the key to continue from, or null when the source
 * has nothing more: a page can be short while `next` is set, because the examined rows were
 * filtered out.
 */
export function scanKeyset<Row, Key>(options: {
  before: Key | null;
  limit: number;
  batch?: number;
  cap?: number;
  fetch: (before: Key | null, count: number) => Row[];
  keyOf: (row: Row) => Key;
  accept: (rows: Row[]) => Set<Row>;
}): { items: Row[]; next: Key | null } {
  const batch = options.batch ?? SCAN_BATCH;
  const cap = options.cap ?? SCAN_CAP;
  const items: Row[] = [];
  let before = options.before;
  let examined = 0;
  let exhausted = false;
  while (items.length < options.limit && examined < cap) {
    const count = Math.min(batch, cap - examined);
    const rows = options.fetch(before, count);
    if (rows.length === 0) {
      exhausted = true;
      break;
    }
    const passing = options.accept(rows);
    for (const row of rows) {
      examined++;
      before = options.keyOf(row);
      if (passing.has(row)) items.push(row);
      if (items.length === options.limit) break;
    }
    if (items.length < options.limit && rows.length < count) {
      exhausted = true;
      break;
    }
  }
  if (exhausted) return { items, next: null };
  // Stopped on the limit or the cap: continue only if the source still has a row below.
  return { items, next: options.fetch(before, 1).length > 0 ? before : null };
}
