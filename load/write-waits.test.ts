import { expect, test } from "bun:test";
import { parseLog } from "./write-waits";

// A failed request as the backend prints it: one error over several lines.
const log = `Sermo listening on http://127.0.0.1:4401/
[db.write-wait] at=2026-10-16T07:31:11.123Z wait=140 hold=3 commit=2
[db.write-wait] at=2026-10-16T07:31:12.456Z wait=1 hold=4 commit=310
API request failed 1 | const result = fn(tx);
SQLiteError: database is locked
      errno: 5,
       code: "SQLITE_BUSY"
[db.write-wait] at=2026-10-16T07:31:17.500Z wait=5001 hold=0 commit=0
`;

test("the log's slow writes and failures are counted once each", () => {
  const { slow, locked, failed } = parseLog(log);
  expect(slow).toEqual([
    { wait: 140, hold: 3, commit: 2 },
    { wait: 1, hold: 4, commit: 310 },
    { wait: 5001, hold: 0, commit: 0 },
  ]);
  expect(locked).toBe(1);
  expect(failed).toBe(1);
});
