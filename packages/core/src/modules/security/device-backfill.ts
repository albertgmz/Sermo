import type * as z from "zod";
import { type Ctx, prepared } from "../../context";
import type { MemberDevice } from "../../contracts/members";
import { holdCheckpoints, paceWal } from "../../db/checkpointer";
import { writeTx } from "../../db/tx";
import { type ClaimedJob, completeRunningJob, enqueueJob, registerJobHandler } from "../jobs/queue";
import { type Device, deviceOf, NO_DEVICE } from "./device";
import { memberDeviceOf } from "./member-device";

/**
 * Gives the members who signed in before devices were kept the device of their newest session,
 * parsed as a sign-in parses it. A member with no session left (sessions end and are purged) gets
 * the device of their newest logged action (`ip_log`) that is not a crawler's or a failed sign-in.
 * It walks the members in id order, a window per chunk, and writes only members with no device yet
 * whose source is still the newest one: a sign-in or an action during the walk keeps what it
 * stored. The place it reached is kept in `site_settings`, so a stopped run goes on from there
 * when the server next starts, and a finished one never runs again.
 */
export const DEVICE_BACKFILL_JOB = "security.deviceBackfill";
/** Members read per chunk; every one of them may be written. */
export const DEVICE_BACKFILL_CHUNK = 500;
/** Low priority: the next chunk waits for a later turn of the job worker. */
const PAUSE_MS = 500;
const RECORD_KEY = "security.deviceBackfill";

type Walk = { after: number } | { done: true };
type Shown = z.infer<typeof MemberDevice>;

// An action that tells something of the member's own device: not a crawler's, not a failed sign-in
// (anyone can try to sign in to an account).
const OWN_DEVICE =
  "action <> 'sign_in_failed' AND is_bot = 0 AND (browser IS NOT NULL OR os IS NOT NULL OR device_type IS NOT NULL)";
const FILL =
  "UPDATE users SET device_type = ?2, device_os = ?3, device_browser = ?4 WHERE id = ?1 AND erased_at IS NULL " +
  "AND device_type IS NULL AND device_os IS NULL AND device_browser IS NULL";

export const deviceBackfillSql = {
  window:
    "SELECT u.id, u.erased_at, u.device_type, u.device_os, u.device_browser, s.id AS session_id, s.user_agent " +
    "FROM users u LEFT JOIN auth_session s ON s.id = (SELECT max(id) FROM auth_session WHERE user_id = u.id) " +
    "WHERE u.id > ?1 ORDER BY u.id LIMIT ?2",
  // The newest action of one member that tells something of their own device. `+id` keeps the
  // planner on the member's index entries: walking the whole table by id from the newest row is
  // never chosen for a member whose last action is old.
  logged: `SELECT id, browser, os, device_type FROM ip_log WHERE user_id = ?1 AND ${OWN_DEVICE} ORDER BY +id DESC LIMIT 1`,
  fillFromSession: `${FILL} AND (SELECT max(id) FROM auth_session WHERE user_id = ?1) = ?5`,
  // Still no session, and no action of the member's own device logged after the one read.
  fillFromLog:
    `${FILL} AND NOT EXISTS (SELECT 1 FROM auth_session WHERE user_id = ?1) ` +
    `AND NOT EXISTS (SELECT 1 FROM ip_log WHERE user_id = ?1 AND id > ?5 AND ${OWN_DEVICE})`,
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

interface LoggedRow {
  id: number;
  browser: string | null;
  os: string | null;
  device_type: string | null;
}

/** A member to write: the device found, and the id of the session or `ip_log` row it came from. */
export interface FoundDevice {
  userId: number;
  source: "session" | "log";
  sourceId: number;
  device: Shown;
}

const nextTurn = () => new Promise<void>((resolve) => setImmediate(resolve));

const waiting = (row: WindowRow): boolean =>
  row.erased_at === null && !row.device_type && !row.device_os && !row.device_browser;

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
 * The device of a member who waits for one: from their newest session when they have one (a
 * session that tells nothing gives none), else from their newest logged action. `ip_log` keeps the
 * detector's own names, so they go through the same normalising as a sign-in's.
 */
function deviceFor(ctx: Ctx, row: WindowRow): FoundDevice | null {
  if (row.session_id !== null) {
    const device = memberDeviceOf(deviceOf(row.user_agent));
    return device && { userId: row.id, source: "session", sourceId: row.session_id, device };
  }
  const logged = prepared(ctx, "security.deviceBackfill.logged", () =>
    ctx.sqlite.prepare<LoggedRow, [number]>(deviceBackfillSql.logged),
  ).get(row.id);
  if (!logged) return null;
  const parsed: Device = {
    ...NO_DEVICE,
    browser: logged.browser,
    os: logged.os,
    deviceType: logged.device_type,
  };
  const device = memberDeviceOf(parsed);
  return device && { userId: row.id, source: "log", sourceId: logged.id, device };
}

/**
 * Reads the window of members after `after` and finds the device of each member who waits for
 * one, outside any transaction and with a turn of the event loop after each member (a parse can
 * take milliseconds).
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
    const device = deviceFor(ctx, row);
    if (device) found.push(device);
    await nextTurn();
  }
  return { read: rows.length, last: rows.at(-1)?.id ?? after, found };
}

/** Writes the devices found, in the caller's transaction; returns how many members it wrote. */
export function fillDevices(ctx: Ctx, found: FoundDevice[]): number {
  const fill = {
    session: prepared(ctx, "security.deviceBackfill.fillFromSession", () =>
      ctx.sqlite.prepare(deviceBackfillSql.fillFromSession),
    ),
    log: prepared(ctx, "security.deviceBackfill.fillFromLog", () =>
      ctx.sqlite.prepare(deviceBackfillSql.fillFromLog),
    ),
  };
  let written = 0;
  for (const { userId, source, sourceId, device } of found)
    written += fill[source].run(userId, device.type, device.os, device.browser, sourceId).changes;
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
