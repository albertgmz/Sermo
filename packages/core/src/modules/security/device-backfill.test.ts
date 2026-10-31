import { describe, expect, test } from "bun:test";
import { createTestContext, expectNoTableScan, insertUser } from "@sermo/core/testing";
import { writeTx } from "../../db/tx";
import { registerJobHandlers, runDueJobs, startScheduler } from "../jobs";
import { deviceOf } from "./device";
import {
  DEVICE_BACKFILL_CHUNK,
  DEVICE_BACKFILL_JOB,
  deviceBackfillSql,
  fillDevices,
  findDevices,
  scheduleDeviceBackfill,
} from "./device-backfill";
import { memberDeviceOf, storeMemberDevice } from "./member-device";

type Ctx = ReturnType<typeof createTestContext>;

const ANDROID_CHROME =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36";
const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const WINDOWS_EDGE =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0";
const GOOGLEBOT = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";

let tokens = 0;
/** A session row as Better Auth writes it on a sign-in: a later sign-in gets a higher id. */
function signIn(ctx: Ctx, userId: number, userAgent: string | null): number {
  tokens += 1;
  const now = ctx.now();
  return ctx.sqlite
    .prepare<{ id: number }, [string, number, number, string | null, number]>(
      "INSERT INTO auth_session (token, expires_at, created_at, updated_at, user_agent, user_id) VALUES (?1, ?2, ?3, ?3, ?4, ?5) RETURNING id",
    )
    .get(`token-${tokens}`, now + 86_400_000, now, userAgent, userId)!.id;
}

function deviceOfMember(ctx: Ctx, userId: number) {
  const row = ctx.sqlite
    .prepare<
      { device_type: string | null; device_os: string | null; device_browser: string | null },
      [number]
    >("SELECT device_type, device_os, device_browser FROM users WHERE id = ?1")
    .get(userId)!;
  if (!row.device_type && !row.device_os && !row.device_browser) return null;
  return { type: row.device_type, os: row.device_os, browser: row.device_browser };
}

const pending = (ctx: Ctx) =>
  ctx.sqlite
    .prepare<{ n: number }, [string]>(
      "SELECT count(*) AS n FROM jobs WHERE type = ?1 AND status IN ('pending', 'running')",
    )
    .get(DEVICE_BACKFILL_JOB)!.n;

/** Runs the walk to its end, moving the clock past each pause between chunks. */
async function finish(ctx: Ctx): Promise<number> {
  let chunks = 0;
  for (; pending(ctx) > 0 && chunks < 100; chunks++) {
    ctx.clock.advance(1_000);
    await runDueJobs(ctx, { limit: 1 });
  }
  return chunks;
}

function world(): Ctx {
  const ctx = createTestContext();
  registerJobHandlers(ctx);
  return ctx;
}

describe("devices of members who signed in before devices were kept", () => {
  test("a member gets the device of their newest session, as a sign-in would store it", async () => {
    const ctx = world();
    const member = insertUser(ctx);
    signIn(ctx, member.id, WINDOWS_EDGE);
    signIn(ctx, member.id, ANDROID_CHROME);
    // The server's start queues the walk.
    startScheduler(ctx)();
    expect(pending(ctx)).toBe(1);
    await finish(ctx);
    expect(deviceOfMember(ctx, member.id)).toEqual({
      type: "phone",
      os: "Android",
      browser: "Chrome",
    });
    expect(deviceOfMember(ctx, member.id)).toEqual(memberDeviceOf(deviceOf(ANDROID_CHROME)));
    // A finished walk is never queued again.
    scheduleDeviceBackfill(ctx);
    expect(pending(ctx)).toBe(0);
  });

  test("a member without a session and an erased member keep no device", async () => {
    const ctx = world();
    const never = insertUser(ctx);
    const erased = insertUser(ctx);
    signIn(ctx, erased.id, ANDROID_CHROME);
    ctx.sqlite.prepare("UPDATE users SET erased_at = 1 WHERE id = ?1").run(erased.id);
    scheduleDeviceBackfill(ctx);
    await finish(ctx);
    expect(deviceOfMember(ctx, never.id)).toBeNull();
    expect(deviceOfMember(ctx, erased.id)).toBeNull();
  });

  test("a crawler, an empty or a missing user agent on the newest session gives no device", async () => {
    const ctx = world();
    const agents = [GOOGLEBOT, "", null];
    const members = agents.map((agent) => {
      const member = insertUser(ctx);
      signIn(ctx, member.id, WINDOWS_EDGE);
      signIn(ctx, member.id, agent);
      return member;
    });
    scheduleDeviceBackfill(ctx);
    await finish(ctx);
    agents.forEach((agent, index) => {
      expect(memberDeviceOf(deviceOf(agent))).toBeNull();
      expect(deviceOfMember(ctx, members[index]!.id)).toBeNull();
    });
  });

  test("a device a sign-in stored is kept", async () => {
    const ctx = world();
    const member = insertUser(ctx);
    signIn(ctx, member.id, WINDOWS_EDGE);
    signIn(ctx, member.id, ANDROID_CHROME);
    storeMemberDevice(ctx, member.id, IPHONE_SAFARI);
    scheduleDeviceBackfill(ctx);
    await finish(ctx);
    expect(deviceOfMember(ctx, member.id)).toEqual(memberDeviceOf(deviceOf(IPHONE_SAFARI)));
  });

  test("a sign-in while the walk reads its window keeps the device it stored", async () => {
    const ctx = world();
    const phone = insertUser(ctx);
    const crawler = insertUser(ctx);
    signIn(ctx, phone.id, WINDOWS_EDGE);
    signIn(ctx, crawler.id, WINDOWS_EDGE);
    const found = await findDevices(ctx, 0);
    expect(found.found.map((member) => member.userId)).toEqual([phone.id, crawler.id]);
    // Both sign in again before the window is written: the sign-in stores its own device.
    signIn(ctx, phone.id, IPHONE_SAFARI);
    storeMemberDevice(ctx, phone.id, IPHONE_SAFARI);
    signIn(ctx, crawler.id, GOOGLEBOT);
    storeMemberDevice(ctx, crawler.id, GOOGLEBOT);
    expect(writeTx(ctx, () => fillDevices(ctx, found.found))).toBe(0);
    expect(deviceOfMember(ctx, phone.id)).toEqual(memberDeviceOf(deviceOf(IPHONE_SAFARI)));
    expect(deviceOfMember(ctx, crawler.id)).toBeNull();
  });

  test("the walk writes a window of members per chunk", async () => {
    const ctx = world();
    const members = Array.from({ length: DEVICE_BACKFILL_CHUNK + 5 }, () => {
      const member = insertUser(ctx);
      signIn(ctx, member.id, ANDROID_CHROME);
      return member;
    });
    scheduleDeviceBackfill(ctx);
    ctx.clock.advance(1_000);
    await runDueJobs(ctx, { limit: 1 });
    const filled = () => members.filter((member) => deviceOfMember(ctx, member.id) !== null);
    expect(filled().length).toBe(DEVICE_BACKFILL_CHUNK);
    expect(await finish(ctx)).toBe(1);
    expect(filled().length).toBe(members.length);
  });

  test("a stopped walk goes on from where it was", async () => {
    const ctx = world();
    const members = Array.from({ length: DEVICE_BACKFILL_CHUNK + 5 }, () => {
      const member = insertUser(ctx);
      signIn(ctx, member.id, ANDROID_CHROME);
      return member;
    });
    scheduleDeviceBackfill(ctx);
    ctx.clock.advance(1_000);
    await runDueJobs(ctx, { limit: 1 });
    // The server stops; the queued chunk is lost with it. A member of the written window loses
    // the device again, so a walk that started over would write it back.
    ctx.sqlite.prepare("DELETE FROM jobs WHERE type = ?1").run(DEVICE_BACKFILL_JOB);
    ctx.sqlite
      .prepare(
        "UPDATE users SET device_type = NULL, device_os = NULL, device_browser = NULL WHERE id = ?1",
      )
      .run(members[0]!.id);
    scheduleDeviceBackfill(ctx);
    expect(await finish(ctx)).toBe(1);
    expect(deviceOfMember(ctx, members.at(-1)!.id)).not.toBeNull();
    expect(deviceOfMember(ctx, members[0]!.id)).toBeNull();
  });

  test("the window is read through keys", () => {
    const ctx = createTestContext();
    expectNoTableScan(ctx, deviceBackfillSql.window, [0, DEVICE_BACKFILL_CHUNK]);
  });
});
