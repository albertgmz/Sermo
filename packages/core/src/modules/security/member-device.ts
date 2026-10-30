import type * as z from "zod";
import { type Ctx, prepared } from "../../context";
import type { MemberDevice } from "../../contracts/members";
import type { DEVICE_TYPES } from "../../db/schema";
import { writeTx } from "../../db/tx";
import { type Device, deviceOf } from "./device";

type Shown = z.infer<typeof MemberDevice>;
type DeviceType = (typeof DEVICE_TYPES)[number];

// The detector's device types that are drawn as a computer, a phone or a tablet; any other type
// (a television, a console, a car) has no icon.
const TYPES: Record<string, DeviceType> = {
  desktop: "desktop",
  smartphone: "phone",
  phablet: "phone",
  "feature phone": "phone",
  tablet: "tablet",
};

// The detector's system names that people know by another name.
const SYSTEMS: Record<string, string> = { Mac: "macOS", "GNU/Linux": "Linux" };

// "Chrome Mobile", "Mobile Safari" and "Chrome Mobile iOS" are Chrome, Safari and Chrome: the
// device type and the system already tell the rest.
function browserName(name: string): string {
  return (
    name
      .replace(/\b(?:Mobile|iOS)\b/g, "")
      .replace(/\s+/g, " ")
      .trim() || name
  );
}

/** What is shown of a parsed user agent next to a member's name; null when it tells nothing. */
export function memberDeviceOf(device: Device): Shown | null {
  if (device.isBot) return null;
  const type = (device.deviceType && TYPES[device.deviceType]) || null;
  const os = device.os && (SYSTEMS[device.os] ?? device.os);
  const browser = device.browser && browserName(device.browser);
  if (!type && !os && !browser) return null;
  return { type, os, browser };
}

export interface MemberDeviceRow {
  device_type: DeviceType | null;
  device_os: string | null;
  device_browser: string | null;
}

/** The device a member row stores; null when the columns are empty. */
export function storedMemberDevice(row: MemberDeviceRow): Shown | null {
  if (!row.device_type && !row.device_os && !row.device_browser) return null;
  return { type: row.device_type, os: row.device_os, browser: row.device_browser };
}

export const memberDeviceSql = {
  store: "UPDATE users SET device_type = ?2, device_os = ?3, device_browser = ?4 WHERE id = ?1",
};

/**
 * Keeps on the member the device of the session that just opened, parsed once here so no read
 * parses it: a session is the member's latest sign-in. An agent that tells nothing clears it.
 */
export function storeMemberDevice(
  ctx: Ctx,
  userId: number,
  userAgent: string | null | undefined,
): void {
  const device = memberDeviceOf(deviceOf(userAgent));
  writeTx(ctx, () => {
    prepared(ctx, "security.memberDevice", () => ctx.sqlite.prepare(memberDeviceSql.store)).run(
      userId,
      device?.type ?? null,
      device?.os ?? null,
      device?.browser ?? null,
    );
  });
}
