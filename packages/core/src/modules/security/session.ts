import type { ClientLocation } from "../../actor";
import { type Ctx, prepared } from "../../context";
import { writeTx } from "../../db/tx";
import { queueAccountEmail } from "../email/account";
import { parseAddress } from "./address";
import { resolveLocation } from "./config";
import { deviceOf } from "./device";
import { NO_LOCATION } from "./location";
import { logMemberIp } from "./log";
import { signNotMe } from "./not-me-token";

export const sessionActivitySql = {
  // What the member's earlier successful sign-ins (retained ones) tell about this one. The
  // `action IN (...)` term repeats the partial index's condition so the index serves the query.
  seen: "SELECT count(*) AS total, count(browser) AS with_browser, coalesce(max(browser = ?2 AND os IS ?3), 0) AS same_browser, count(country) AS with_country, coalesce(max(country = ?4), 0) AS same_country FROM ip_log WHERE user_id = ?1 AND action IN ('sign_in', 'sign_in_failed') AND action = 'sign_in'",
  email: "SELECT email FROM auth_user WHERE id = ?1",
  open: "INSERT OR REPLACE INTO session_activity (session_id, last_active_at, country, region, city) VALUES (?1, ?2, ?3, ?4, ?5)",
  touch:
    "INSERT INTO session_activity (session_id, last_active_at) SELECT id, ?2 FROM auth_session WHERE id = ?1 ON CONFLICT (session_id) DO UPDATE SET last_active_at = excluded.last_active_at WHERE excluded.last_active_at > session_activity.last_active_at",
};

interface Seen {
  total: number;
  with_browser: number;
  same_browser: number;
  with_country: number;
  same_country: number;
}

/**
 * Records a sign-in: the `ip_log` row, the session's place and last use, and, when the sign-in
 * comes from a browser or a country the member's retained sign-ins do not show, the mail with the
 * "This wasn't me" link. No mail for a crawler, for the member's first sign-in (nothing to compare
 * with), or when the browser or country is unknown or the history holds none to compare. Not
 * written by registration, which logs its own row.
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
  const location = address ? resolveLocation(ctx, address.ip, input.location) : NO_LOCATION;
  let alertToken: string | null = null;
  if (address && !device.isBot) {
    const seen = prepared(ctx, "security.signInSeen", () =>
      ctx.sqlite.prepare<Seen, [number, string | null, string | null, string | null]>(
        sessionActivitySql.seen,
      ),
    ).get(input.userId, device.browser, device.os, location.country);
    if (seen && seen.total > 0) {
      const newBrowser = device.browser !== null && seen.with_browser > 0 && !seen.same_browser;
      const newCountry = location.country !== null && seen.with_country > 0 && !seen.same_country;
      if (newBrowser || newCountry) alertToken = await signNotMe(ctx, input.userId);
    }
  }
  writeTx(ctx, () => {
    const now = ctx.now();
    logMemberIp(ctx, input.userId, input.ip, input.userAgent, "sign_in", undefined, location);
    prepared(ctx, "security.sessionOpen", () => ctx.sqlite.prepare(sessionActivitySql.open)).run(
      input.sessionId,
      now,
      location.country,
      location.region,
      location.city,
    );
    if (!alertToken) return;
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
      device: { browser: device.browser, os: device.os },
      location,
      at: now,
    });
  });
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
