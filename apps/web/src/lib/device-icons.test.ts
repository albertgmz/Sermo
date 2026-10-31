import { expect, test } from "bun:test";
import { createTranslator } from "use-intl";
import enForum from "../../messages/en/forum.json";
import esForum from "../../messages/es/forum.json";
import {
  type DeviceFields,
  deviceIcon,
  deviceLabel,
  NO_DEVICE,
  systemIcon,
  systemLabel,
} from "./device-icons";

const device = (part: Partial<DeviceFields>): DeviceFields => ({
  ...NO_DEVICE,
  ...part,
});
const en = createTranslator({
  locale: "en",
  messages: { forum: enForum },
  namespace: "forum.deviceIcons",
});
const es = createTranslator({
  locale: "es",
  messages: { forum: esForum },
  namespace: "forum.deviceIcons",
});

test("the system's icon is the file named after the detector's code", () => {
  const ubuntu = device({ os: "Ubuntu", osCode: "UBT", osFamily: "GNU/Linux" });
  expect(systemIcon(ubuntu).key).toBe("os/UBT");
  expect(systemIcon(ubuntu).src).toEndWith("/os/UBT.webp");
  expect(
    systemIcon(device({ os: "Haiku OS", osCode: "HAI", osFamily: "BeOS" })).key,
  ).toBe("os/HAI");
  for (const code of ["BSD", "OBS", "NBS"])
    expect(systemIcon(device({ osCode: code, osFamily: "Unix" })).key).toBe(
      `os/${code}`,
    );
  // Kept as SVG where matomo-icons has one.
  expect(systemIcon(device({ os: "Android", osCode: "AND" })).src).toEndWith(
    "/os/AND.svg",
  );
});

test("a GNU/Linux system without an icon of its own is drawn as Tux", () => {
  const alpine = device({
    os: "Alpine Linux",
    osCode: "ALP",
    osFamily: "GNU/Linux",
  });
  expect(systemIcon(alpine)).toMatchObject({ key: "os/LIN", unknown: false });
  // A system of another family without an icon is unknown.
  expect(
    systemIcon(
      device({ os: "OpenHarmony", osCode: "OHS", osFamily: "OpenHarmony" }),
    ).key,
  ).toBe("os/UNK");
});

test("a system without an icon of its own takes the icon of the system its family is named after", () => {
  const icon = (osCode: string, osFamily: string) =>
    systemIcon(device({ osCode, osFamily })).key;
  // Lineage OS, Wear OS and Android Go are of the Android family.
  expect(icon("LEN", "Android")).toBe("os/AND");
  expect(icon("WER", "Android")).toBe("os/AND");
  expect(icon("AGO", "Android")).toBe("os/AND");
  // Chromium OS and FydeOS are of the Chrome OS family; Series 60 of Symbian.
  expect(icon("CRS", "Chrome OS")).toBe("os/COS");
  expect(icon("FYD", "Chrome OS")).toBe("os/COS");
  expect(icon("S60", "Symbian")).toBe("os/SYM");
  // A family named after no system has no icon: GhostBSD is of the Unix family.
  expect(icon("GHO", "Unix")).toBe("os/UNK");
});

test("a dark logo gets a light edge on the dark theme; a glyph of one colour is a mask instead", () => {
  expect(systemIcon(device({ osCode: "DEB" }))).toMatchObject({
    dark: true,
    monochrome: false,
  });
  // HarmonyOS: matomo-icons lists it as a glyph, but it fills its square.
  expect(systemIcon(device({ osCode: "HAR" }))).toMatchObject({
    dark: true,
    monochrome: false,
  });
  expect(systemIcon(device({ osCode: "IOS" }))).toMatchObject({
    dark: false,
    monochrome: true,
  });
  expect(systemIcon(device({ osCode: "UBT" }))).toMatchObject({
    dark: false,
    monochrome: false,
  });
});

test("no code, or one without a file, is matomo's unknown icon; an old name that says Linux is Tux", () => {
  expect(systemIcon(NO_DEVICE)).toMatchObject({ key: "os/UNK", unknown: true });
  expect(systemIcon(device({ osCode: "ZZZ" })).key).toBe("os/UNK");
  // Members whose only data is the old stored names: the detector could not map them to a code.
  expect(systemIcon(device({ os: "macOS" })).key).toBe("os/UNK");
  expect(systemIcon(device({ os: "Linux" })).key).toBe("os/LIN");
  // A code is never looked up through the prototype.
  expect(systemIcon(device({ osCode: "constructor" })).key).toBe("os/UNK");
});

test("the device's icon is the file named after the detector's type", () => {
  expect(deviceIcon(device({ deviceType: "smartphone" }))).toMatchObject({
    key: "devices/smartphone",
    monochrome: true,
    unknown: false,
  });
  expect(deviceIcon(device({ deviceType: "feature phone" })).key).toBe(
    "devices/feature_phone",
  );
  expect(
    deviceIcon(device({ deviceType: "portable media player" })).src,
  ).toEndWith("/devices/portable_media_player.svg");
  expect(deviceIcon(NO_DEVICE)).toMatchObject({
    key: "devices/unknown",
    unknown: true,
  });
  expect(deviceIcon(device({ deviceType: "hologram" })).key).toBe(
    "devices/unknown",
  );
});

test("dark glyphs of one colour are marked so a dark theme can invert them", () => {
  expect(systemIcon(device({ osCode: "IOS" })).monochrome).toBe(true);
  expect(systemIcon(device({ osCode: "UBT" })).monochrome).toBe(false);
});

test("the device names its type, then its brand when it is known", () => {
  expect(
    deviceLabel(device({ deviceType: "smartphone", brand: "Samsung" }), en),
  ).toBe("Smartphone — Samsung");
  expect(deviceLabel(device({ deviceType: "desktop" }), en)).toBe("Computer");
  expect(deviceLabel(NO_DEVICE, en)).toBe("Unknown device");
  expect(
    deviceLabel(device({ deviceType: "smartphone", brand: "Samsung" }), es),
  ).toBe("Móvil — Samsung");
});

test("the system names the system and its version, then the browser and its major version", () => {
  const full = device({
    os: "Ubuntu",
    osVersion: "24.04",
    browser: "Firefox",
    browserVersion: "132.0",
  });
  expect(systemLabel(full, en)).toBe("Ubuntu 24.04 · Firefox 132");
  expect(
    systemLabel(
      device({
        os: "Android",
        osVersion: "14",
        browser: "Chrome",
        browserVersion: "132.0.0.0",
      }),
      en,
    ),
  ).toBe("Android 14 · Chrome 132");
  // Without versions, or without a browser.
  expect(systemLabel(device({ os: "Android", browser: "Chrome" }), en)).toBe(
    "Android · Chrome",
  );
  expect(systemLabel(device({ os: "Windows", osVersion: "11" }), en)).toBe(
    "Windows 11",
  );
  // A version is never shown without its name.
  expect(
    systemLabel(
      device({ osVersion: "11", browser: "Edge", browserVersion: "131" }),
      en,
    ),
  ).toBe("Unknown system · Edge 131");
  expect(systemLabel(NO_DEVICE, en)).toBe("Unknown system");
  expect(systemLabel(NO_DEVICE, es)).toBe("Sistema desconocido");
});

test("every device type with an icon has its name in both languages", () => {
  const types = (forum: typeof enForum) =>
    Object.keys(forum.deviceIcons.types).sort();
  expect(types(esForum)).toEqual(types(enForum));
  for (const type of types(enForum))
    expect(
      deviceLabel(device({ deviceType: type.replaceAll("_", " ") }), en),
    ).toBe(
      enForum.deviceIcons.types[type as keyof typeof enForum.deviceIcons.types],
    );
});
