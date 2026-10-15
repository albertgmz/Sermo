import type { ClientLocation } from "../../actor";
import { type Ctx, prepared } from "../../context";
import { writeTx } from "../../db/tx";
import { accountEmailEnabled, queueAccountEmail } from "../email/account";
import { parseAddress } from "./address";
import { resolveLocation } from "./config";
import { type Device, deviceOf } from "./device";
import { NO_LOCATION } from "./location";
import { insertIpRow } from "./log";
import { signNotMe } from "./not-me-token";

const SIGN_INS = "user_id = ?1 AND action IN ('sign_in', 'sign_in_failed')";
// The browser as the alert tells browsers apart: its name and system. A crawler, an empty or an
// unreadable user agent all count as one browser, "unknown", compared like any other: the
// agent is whatever the signer sends, so exempting it would let anyone with the password skip the
// alert. The same expression in SQL and in `deviceKey`.
const DEVICE_KEY =
  "CASE WHEN is_bot = 1 OR browser IS NULL THEN 'unknown' ELSE browser || '/' || coalesce(os, '') END";
export function deviceKey(device: Device): string {
  return device.isBot || device.browser === null
    ? "unknown"
    : `${device.browser}/${device.os ?? ""}`;
}

export const sessionActivitySql = {
  // What the member's earlier successful sign-ins (retained ones) tell about this one, as four
  // EXISTS checks that each stop at the first row that answers them (newest first, through the
  // partial index: the `action IN (...)` term repeats its condition). A match is found at once
  // for a browser or country the member uses; a scan to the end of their retained sign-ins (at
  // most the retention age) happens only when nothing matches, which is when an alert follows.
  // ?2 is the device key (`deviceKey`); ?3 a country or null (null skips both country checks).
  seen: `SELECT
    EXISTS (SELECT 1 FROM ip_log WHERE ${SIGN_INS} AND action = 'sign_in') AS any_prior,
    EXISTS (SELECT 1 FROM ip_log WHERE ${SIGN_INS} AND action = 'sign_in' AND ${DEVICE_KEY} = ?2) AS same_device,
    CASE WHEN ?3 IS NULL THEN 0 ELSE EXISTS (SELECT 1 FROM ip_log WHERE ${SIGN_INS} AND action = 'sign_in' AND country = ?3) END AS same_country,
    CASE WHEN ?3 IS NULL THEN 0 ELSE EXISTS (SELECT 1 FROM ip_log WHERE ${SIGN_INS} AND action = 'sign_in' AND country IS NOT NULL) END AS any_country`,
  email: "SELECT email FROM auth_user WHERE id = ?1",
  // From auth_session, so a session that is already gone leaves no row and no error.
  open: "INSERT OR REPLACE INTO session_activity (session_id, last_active_at, country, region, city) SELECT id, ?2, ?3, ?4, ?5 FROM auth_session WHERE id = ?1",
  touch:
    "INSERT INTO session_activity (session_id, last_active_at) SELECT id, ?2 FROM auth_session WHERE id = ?1 ON CONFLICT (session_id) DO UPDATE SET last_active_at = excluded.last_active_at WHERE excluded.last_active_at > session_activity.last_active_at",
};

interface Seen {
  any_prior: number;
  same_device: number;
  same_country: number;
  any_country: number;
}

/**
 * Records a sign-in: the `ip_log` row, the session's place and last use, and, when the sign-in
 * comes from a browser or a country the member's retained sign-ins do not show, the mail with the
 * "This wasn't me" link. A crawler or an unreadable user agent is the browser "unknown" like any
 * other. No mail for the member's first sign-in (nothing to compare with), when this sign-in has
 * no known country, or when no earlier one has a country to compare with. Not written by
 * registration, which logs its own row.
 */
export async function recordSignIn(
  ctx: Ctx,
  input: {
    userId: number;
    sessionId: number;
    ip: string | null | undefined;
    userAgent: string | null | undefined;
    location: ClientLocation | null | undefined;
  },
): Promise<void> {
  const address = parseAddress(input.ip);
  const device = deviceOf(input.userAgent);
  // Looked up once: the row below takes this result as it is.
  const location = address ? resolveLocation(ctx, address.ip, input.location) : NO_LOCATION;
  let alertToken: string | null = null;
  if (address && accountEmailEnabled(ctx)) {
    try {
      const seen = prepared(ctx, "security.signInSeen", () =>
        ctx.sqlite.prepare<Seen, [number, string, string | null]>(sessionActivitySql.seen),
      ).get(input.userId, deviceKey(device), location.country);
      if (seen?.any_prior) {
        const newBrowser = !seen.same_device;
        const newCountry = location.country !== null && seen.any_country && !seen.same_country;
        if (newBrowser || newCountry) alertToken = await signNotMe(ctx, input.userId);
      }
    } catch (error) {
      // No alert is better than losing the record of the sign-in.
      console.error("The new-sign-in check failed", error);
    }
  }
  const now = ctx.now();
  writeTx(ctx, () => {
    if (address) insertIpRow(ctx, input.userId, address, device, location, "sign_in");
    prepared(ctx, "security.sessionOpen", () => ctx.sqlite.prepare(sessionActivitySql.open)).run(
      input.sessionId,
      now,
      location.country,
      location.region,
      location.city,
    );
  });
  if (!alertToken) return;
  try {
    writeTx(ctx, () => {
      const member = prepared(ctx, "security.memberEmail", () =>
        ctx.sqlite.prepare<{ email: string }, [number]>(sessionActivitySql.email),
      ).get(input.userId);
      if (!member) return;
      const site = ctx.config.siteBaseURL ?? ctx.config.auth?.baseURL ?? "http://localhost:3000";
      queueAccountEmail(ctx, {
        kind: "newDevice",
        userId: input.userId,
        email: member.email,
        url: `${site}/not-me?token=${encodeURIComponent(alertToken)}`,
        device:
          deviceKey(device) === "unknown"
            ? { browser: null, os: null }
            : { browser: device.browser, os: device.os },
        location,
        at: now,
      });
    });
  } catch (error) {
    console.error("The new-sign-in mail could not be queued", error);
  }
}

/** A session's last-active time is moved forward at most once per this long, per session. */
export const ACTIVE_STEP_MS = 5 * 60_000;

interface ActivityState {
  /** When each session was last noted: the throttle. */
  seen: Map<number, number>;
  /** Noted sessions not yet written. */
  pending: Map<number, number>;
}
const states = new WeakMap<Ctx, ActivityState>();

/**
 * Notes that a session was used. Cheap and never writes: one map lookup per request, and a
 * session is noted again only after `ACTIVE_STEP_MS`. `flushSessionActivity` writes the notes.
 */
export function noteSessionActive(ctx: Ctx, sessionId: number): void {
  let state = states.get(ctx);
  if (!state) {
    state = { seen: new Map(), pending: new Map() };
    states.set(ctx, state);
  }
  const now = ctx.now();
  const last = state.seen.get(sessionId);
  if (last !== undefined && now - last < ACTIVE_STEP_MS) return;
  state.seen.set(sessionId, now);
  state.pending.set(sessionId, now);
}

/**
 * Writes the noted sessions' last-active times in one short transaction (one upsert per session,
 * at most one per session per `ACTIVE_STEP_MS`), and forgets throttle entries that have run out.
 * A session deleted since it was noted gets no row.
 */
export function flushSessionActivity(ctx: Ctx): number {
  const state = states.get(ctx);
  if (!state) return 0;
  const now = ctx.now();
  for (const [id, at] of state.seen) if (now - at >= ACTIVE_STEP_MS) state.seen.delete(id);
  const batch = [...state.pending];
  state.pending.clear();
  if (!batch.length) return 0;
  try {
    writeTx(ctx, () => {
      const touch = prepared(ctx, "security.sessionTouch", () =>
        ctx.sqlite.prepare(sessionActivitySql.touch),
      );
      for (const [id, at] of batch) touch.run(id, at);
    });
  } catch (error) {
    for (const [id, at] of batch) state.pending.set(id, Math.max(state.pending.get(id) ?? 0, at));
    throw error;
  }
  return batch.length;
}

/** The time a session was noted but not yet written, so a list shows its use at once. */
export function pendingSessionActivity(ctx: Ctx, sessionId: number): number | undefined {
  return states.get(ctx)?.pending.get(sessionId);
}
