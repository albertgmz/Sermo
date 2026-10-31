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
  if (!os && !browser && !device.deviceType) return null;
  return {
    type,
    os,
    browser,
    deviceType: device.deviceType,
    brand: device.brand,
    brandCode: device.brandCode,
    osCode: device.osCode,
    osVersion: device.osVersion,
    osFamily: device.osFamily,
    browserCode: device.browserCode,
    browserVersion: device.browserVersion,
  };
}

/** The `users` column that keeps each field of a member's device. */
const COLUMNS: { [K in keyof Shown]-?: string } = {
  type: "device_type",
  os: "device_os",
  browser: "device_browser",
  deviceType: "device_type_name",
  brand: "device_brand",
  brandCode: "device_brand_code",
  osCode: "device_os_code",
  osVersion: "device_os_version",
  osFamily: "device_os_family",
  browserCode: "device_browser_code",
  browserVersion: "device_browser_version",
};
const FIELDS = Object.keys(COLUMNS) as (keyof Shown)[];

/** The columns a member row is read with, as a list for a `SELECT` of `users u`. */
export const MEMBER_DEVICE_COLUMNS = FIELDS.map((field) => `u.${COLUMNS[field]}`).join(", ");

export interface MemberDeviceRow {
  device_type: DeviceType | null;
  device_os: string | null;
  device_browser: string | null;
  device_type_name: string | null;
  device_brand: string | null;
  device_brand_code: string | null;
  device_os_code: string | null;
  device_os_version: string | null;
  device_os_family: string | null;
  device_browser_code: string | null;
  device_browser_version: string | null;
}

/** Whether a member row holds no device at all. */
export const hasNoDevice = (row: MemberDeviceRow): boolean =>
  FIELDS.every((field) => !row[COLUMNS[field] as keyof MemberDeviceRow]);

/** The device a member row stores; null when the columns are empty. */
export function storedMemberDevice(row: MemberDeviceRow): Shown | null {
  if (hasNoDevice(row)) return null;
  return Object.fromEntries(
    FIELDS.map((field) => [field, row[COLUMNS[field] as keyof MemberDeviceRow]]),
  ) as Shown;
}

/** `column = ?n` for each field, numbered from ?2 (?1 is the member's id), to put after `SET`. */
export const MEMBER_DEVICE_SET = FIELDS.map(
  (field, index) => `${COLUMNS[field]} = ?${index + 2}`,
).join(", ");
/** The first parameter number after the ones of `MEMBER_DEVICE_SET`. */
export const MEMBER_DEVICE_NEXT_PARAM = FIELDS.length + 2;

export const memberDeviceSql = {
  store: `UPDATE users SET ${MEMBER_DEVICE_SET} WHERE id = ?1`,
};

/** The values of `memberDeviceSql.store` after the member's id, in its order; null clears them. */
export const memberDeviceValues = (device: Shown | null): (string | null)[] =>
  FIELDS.map((field) => device?.[field] ?? null);

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
      ...memberDeviceValues(device),
    );
  });
}
