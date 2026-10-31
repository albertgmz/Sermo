import type { Device } from "@sermo/core/contracts";
import type { useTranslations } from "next-intl";
import type * as z from "zod";
import {
  DARK_ICONS,
  DEVICE_ICON_FILES,
  FAMILY_ICON_CODES,
  MONOCHROME_ICONS,
  OS_ICON_FILES,
} from "@/lib/device-icon-files";

// What is drawn for a device the backend parsed: the icon of its type and the icon of its system,
// from matomo-icons (`scripts/device-icons.ts` vendors them), and the words of their tooltips. A
// file is named after the detector's own type or code; nothing maps names to files by hand.

/** The fields of a device that the icons and their words read (a member's or a session's). */
export type DeviceFields = Pick<
  z.output<typeof Device>,
  | "deviceType"
  | "brand"
  | "os"
  | "osCode"
  | "osVersion"
  | "osFamily"
  | "browser"
  | "browserVersion"
>;

/** A device the backend knows nothing of. */
export const NO_DEVICE: DeviceFields = {
  deviceType: null,
  brand: null,
  os: null,
  osCode: null,
  osVersion: null,
  osFamily: null,
  browser: null,
  browserVersion: null,
};

type DeviceType = keyof typeof DEVICE_ICON_FILES;
type SystemCode = keyof typeof OS_ICON_FILES;

const UNKNOWN_DEVICE: DeviceType = "unknown";
const UNKNOWN_SYSTEM: SystemCode = "UNK";
// Tux, for an old stored name that says Linux.
const LINUX: SystemCode = "LIN";

export type DeviceIconFile = {
  /** `group/name`, as matomo-icons names the file. */
  key: string;
  src: string;
  /** A dark glyph of one colour: drawn in the colour of the text. */
  monochrome: boolean;
  /** Another dark picture: a light edge keeps it visible on the dark theme. */
  dark: boolean;
  /** matomo-icons' unknown icon, which is empty. */
  unknown: boolean;
};

// Next gives a static file as an object with its address; Bun's own loader (the tests) gives the
// file's path.
type StaticFile = string | { src: string };

function iconFile(
  group: string,
  name: string,
  file: StaticFile,
  unknown: boolean,
) {
  const key = `${group}/${name}`;
  return {
    key,
    src: typeof file === "string" ? file : file.src,
    monochrome: MONOCHROME_ICONS.has(key),
    dark: DARK_ICONS.has(key),
    unknown,
  };
}

const known = <T extends object>(
  table: T,
  name: string | null,
): name is keyof T & string => name !== null && Object.hasOwn(table, name);

/** The detector's device type as matomo-icons names its file: `feature phone` is `feature_phone`. */
function deviceType(device: DeviceFields): DeviceType {
  const name = device.deviceType?.replaceAll(" ", "_") ?? null;
  return known(DEVICE_ICON_FILES, name) ? name : UNKNOWN_DEVICE;
}

/**
 * The system's own icon; else the icon of the system its family is named after (Lineage OS, of the
 * Android family, is drawn as Android; Alpine Linux, of the GNU/Linux family, as Tux); else Tux
 * for an old stored name that says Linux (the detector could not give it a code); else the
 * unknown icon.
 */
function systemCode(device: DeviceFields): SystemCode {
  if (known(OS_ICON_FILES, device.osCode)) return device.osCode;
  if (known(FAMILY_ICON_CODES, device.osFamily))
    return FAMILY_ICON_CODES[device.osFamily];
  return !device.osCode && /linux/i.test(device.os ?? "")
    ? LINUX
    : UNKNOWN_SYSTEM;
}

export function deviceIcon(device: DeviceFields): DeviceIconFile {
  const type = deviceType(device);
  return iconFile(
    "devices",
    type,
    DEVICE_ICON_FILES[type],
    type === UNKNOWN_DEVICE,
  );
}

export function systemIcon(device: DeviceFields): DeviceIconFile {
  const code = systemCode(device);
  return iconFile("os", code, OS_ICON_FILES[code], code === UNKNOWN_SYSTEM);
}

type Translate = ReturnType<typeof useTranslations<"forum.deviceIcons">>;

/** "Smartphone — Samsung": the type, then the brand when it is known. */
export function deviceLabel(device: DeviceFields, t: Translate): string {
  const type = t(`types.${deviceType(device)}`);
  return device.brand ? t("deviceBrand", { type, brand: device.brand }) : type;
}

const named = (name: string | null, version: string | null | undefined) =>
  name ? [name, version].filter(Boolean).join(" ") : null;

/**
 * "Ubuntu 24.04 · Firefox 132": the system and its version, then the browser and its major
 * version (a browser's full version is mostly zeros, "132.0.0.0").
 */
export function systemLabel(device: DeviceFields, t: Translate): string {
  const system = named(device.os, device.osVersion);
  const browser = named(device.browser, device.browserVersion?.split(".")[0]);
  if (!browser) return system ?? t("unknownSystem");
  return t("systemBrowser", { system: system ?? t("unknownSystem"), browser });
}

type ClientTranslate = ReturnType<typeof useTranslations<"forum.clientIcons">>;

/** "Chrome on Windows", with a stand-in for a name the backend could not parse. */
export function clientLabel(
  device: Pick<DeviceFields, "browser" | "os">,
  t: ClientTranslate,
): string {
  return t("label", {
    browser: device.browser ?? t("unknownBrowser"),
    system: device.os ?? t("unknownSystem"),
  });
}
