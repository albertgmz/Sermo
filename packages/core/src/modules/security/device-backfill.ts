import type * as z from "zod";
import { type Ctx, prepared } from "../../context";
import type { MemberDevice } from "../../contracts/members";
import { holdCheckpoints, paceWal } from "../../db/checkpointer";
import { writeTx } from "../../db/tx";
import { type ClaimedJob, completeRunningJob, enqueueJob, registerJobHandler } from "../jobs/queue";
import { deviceOf } from "./device";
import { memberDeviceOf } from "./member-device";

/**
 * Gives the members who signed in before devices were kept the device of their newest session,
 * parsed as a sign-in parses it. It walks the members in id order, a window per chunk, and writes
 * only members with no device yet whose newest session is still the one it read: a sign-in during
 * the walk keeps the device it stored. The place it reached is kept in `site_settings`, so a
 * stopped run goes on from there when the server next starts, and a finished one never runs again.
 */
export const DEVICE_BACKFILL_JOB = "security.deviceBackfill";
/** Members read per chunk; every one of them may be written. */
export const DEVICE_BACKFILL_CHUNK = 500;
/** Low priority: the next chunk waits for a later turn of the job worker. */
const PAUSE_MS = 500;
const RECORD_KEY = "security.deviceBackfill";

type Walk = { after: number } | { done: true };
type Shown = z.infer<typeof MemberDevice>;

export const deviceBackfillSql = {
  window:
    "SELECT u.id, u.erased_at, u.device_type, u.device_os, u.device_browser, s.id AS session_id, s.user_agent " +
    "FROM users u LEFT JOIN auth_session s ON s.id = (SELECT max(id) FROM auth_session WHERE user_id = u.id) " +
    "WHERE u.id > ?1 ORDER BY u.id LIMIT ?2",
  fill:
    "UPDATE users SET device_type = ?2, device_os = ?3, device_browser = ?4 WHERE id = ?1 AND erased_at IS NULL " +
    "AND device_type IS NULL AND device_os IS NULL AND device_browser IS NULL " +
    "AND (SELECT max(id) FROM auth_session WHERE user_id = ?1) = ?5",
  record: "SELECT value FROM site_settings WHERE key = ?1",
  setRecord:
    "INSERT INTO site_settings (key, value, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
};

interface WindowRow {
  id: number;
  erased_at: number | null;
  device_type: string | null;
  device_os: string | null;
  device_browser: string | null;
  session_id: number | null;
  user_agent: string | null;
}

/** A member to write: the device of their newest session, and that session's id. */
export interface FoundDevice {
  userId: number;
  sessionId: number;
  device: Shown;
}

const nextTurn = () => new Promise<void>((resolve) => setImmediate(resolve));

const waiting = (row: WindowRow): row is WindowRow & { session_id: number } =>
  row.session_id !== null &&
  row.erased_at === null &&
  !row.device_type &&
  !row.device_os &&
  !row.device_browser;

function readRecord(ctx: Ctx): Walk {
  const row = prepared(ctx, "security.deviceBackfill.record", () =>
    ctx.sqlite.prepare<{ value: string }, [string]>(deviceBackfillSql.record),
  ).get(RECORD_KEY);
  return row ? (JSON.parse(row.value) as Walk) : { after: 0 };
}

function writeRecord(ctx: Ctx, record: Walk): void {
  prepared(ctx, "security.deviceBackfill.setRecord", () =>
    ctx.sqlite.prepare(deviceBackfillSql.setRecord),
  ).run(RECORD_KEY, JSON.stringify(record), ctx.now());
}

/**
 * Reads the window of members after `after` and parses the newest session of each member who
 * waits for a device, outside any transaction and with a turn of the event loop after each parse
 * (a parse can take milliseconds). A session that tells nothing gives no member to write.
 */
export async function findDevices(
  ctx: Ctx,
  after: number,
): Promise<{ read: number; last: number; found: FoundDevice[] }> {
  const rows = prepared(ctx, "security.deviceBackfill.window", () =>
    ctx.sqlite.prepare<WindowRow, [number, number]>(deviceBackfillSql.window),
  ).all(after, DEVICE_BACKFILL_CHUNK);
  const found: FoundDevice[] = [];
  for (const row of rows) {
    if (!waiting(row)) continue;
    const device = memberDeviceOf(deviceOf(row.user_agent));
    if (device) found.push({ userId: row.id, sessionId: row.session_id, device });
    await nextTurn();
  }
  return { read: rows.length, last: rows.at(-1)?.id ?? after, found };
}

/** Writes the devices found, in the caller's transaction; returns how many members it wrote. */
export function fillDevices(ctx: Ctx, found: FoundDevice[]): number {
  const fill = prepared(ctx, "security.deviceBackfill.fill", () =>
    ctx.sqlite.prepare(deviceBackfillSql.fill),
  );
  let written = 0;
  for (const { userId, sessionId, device } of found)
    written += fill.run(userId, device.type, device.os, device.browser, sessionId).changes;
  return written;
}

/**
 * One window, written in one transaction that also completes the job and queues the next window
 * (or records the walk finished). Returns how many members it wrote.
 */
export async function deviceBackfillChunk(ctx: Ctx, job: ClaimedJob): Promise<number> {
  const start = readRecord(ctx);
  if ("done" in start) return 0;
  const window = await findDevices(ctx, start.after);
  await paceWal(ctx);
  const release = holdCheckpoints(ctx);
  try {
    return writeTx(ctx, () => {
      if (!completeRunningJob(ctx, job)) return 0;
      const record = readRecord(ctx);
      if ("done" in record || record.after !== start.after) return 0;
      const written = fillDevices(ctx, window.found);
      const next: Walk =
        window.read === DEVICE_BACKFILL_CHUNK ? { after: window.last } : { done: true };
      writeRecord(ctx, next);
      if (!("done" in next))
        enqueueJob(
          ctx,
          DEVICE_BACKFILL_JOB,
          {},
          { uniqueKey: DEVICE_BACKFILL_JOB, runAt: ctx.now() + PAUSE_MS },
        );
      return written;
    });
  } finally {
    release();
  }
}

/** Queues the walk unless it has finished; one that is queued or running already is left alone. */
export function scheduleDeviceBackfill(ctx: Ctx): void {
  if ("done" in readRecord(ctx)) return;
  enqueueJob(ctx, DEVICE_BACKFILL_JOB, {}, { uniqueKey: DEVICE_BACKFILL_JOB });
}

export function registerDeviceBackfillJob(ctx: Ctx): void {
  registerJobHandler(
    ctx,
    DEVICE_BACKFILL_JOB,
    async (context, _payload, job) => {
      await deviceBackfillChunk(context, job);
    },
    { holdCheckpoints: false },
  );
}
