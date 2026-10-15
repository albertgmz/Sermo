// A ranked list numbers its rows from one, but a cursor says nothing of how many rows came before
// it. The cursor a numbered page hands on carries the rank of the first row it starts at, in front
// of the backend's own ("21.abc"), so the page that follows can number its rows, for the browser's
// next page and for the address alike.
export function numberedCursor(start: number, cursor: string) {
  return `${start}.${cursor}`;
}

const NUMBERED = /^(\d{1,7})\.([\s\S]+)$/;

export function readNumbered(value: string | null | undefined): {
  start: number;
  cursor: string | undefined;
} {
  const found = value ? NUMBERED.exec(value) : null;
  if (!found) return { start: 1, cursor: value || undefined };
  return { start: Number(found[1]), cursor: found[2] };
}
