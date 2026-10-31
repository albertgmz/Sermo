import { describe, expect, test } from "bun:test";
import { deviceFromNames, deviceOf } from "./device";
import { memberDeviceOf } from "./member-device";

const UBUNTU_FIREFOX =
  "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0";
const FREEBSD_FIREFOX = "Mozilla/5.0 (X11; FreeBSD amd64; rv:132.0) Gecko/20100101 Firefox/132.0";
const HAIKU_WEBPOSITIVE =
  "Mozilla/5.0 (Haiku) AppleWebKit/605.1.15 (KHTML, like Gecko) WebPositive/1.2 Safari/605.1.15";
const SAMSUNG_CHROME =
  "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36";
const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const GOOGLEBOT = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";

describe("what is kept of a user agent: the detector's own names, codes and versions", () => {
  test("Firefox on Ubuntu", () => {
    expect(memberDeviceOf(deviceOf(UBUNTU_FIREFOX))).toEqual({
      type: "desktop",
      os: "Ubuntu",
      browser: "Firefox",
      deviceType: "desktop",
      brand: null,
      brandCode: null,
      osCode: "UBT",
      osVersion: null,
      osFamily: "GNU/Linux",
      browserCode: "FF",
      browserVersion: "132.0",
    });
  });

  test("Firefox on FreeBSD", () => {
    expect(memberDeviceOf(deviceOf(FREEBSD_FIREFOX))).toMatchObject({
      os: "FreeBSD",
      osCode: "BSD",
      osFamily: "Unix",
      browserCode: "FF",
    });
  });

  test("WebPositive on Haiku", () => {
    expect(memberDeviceOf(deviceOf(HAIKU_WEBPOSITIVE))).toMatchObject({
      os: "Haiku OS",
      osCode: "HAI",
      osFamily: "BeOS",
      browser: "WebPositive",
      browserCode: "WE",
    });
  });

  test("Chrome on a Samsung phone with Android", () => {
    expect(memberDeviceOf(deviceOf(SAMSUNG_CHROME))).toEqual({
      type: "phone",
      os: "Android",
      browser: "Chrome",
      deviceType: "smartphone",
      brand: "Samsung",
      brandCode: "SA",
      osCode: "AND",
      osVersion: "14",
      osFamily: "Android",
      browserCode: "CM",
      browserVersion: "129.0.0.0",
    });
  });

  test("Safari on an iPhone", () => {
    expect(memberDeviceOf(deviceOf(IPHONE_SAFARI))).toMatchObject({
      type: "phone",
      os: "iOS",
      osCode: "IOS",
      osVersion: "17.5",
      brand: "Apple",
      brandCode: "AP",
      browser: "Safari",
      browserVersion: "17.5",
    });
  });

  test("a crawler keeps nothing", () => {
    expect(memberDeviceOf(deviceOf(GOOGLEBOT))).toBeNull();
  });
});

describe("the codes of the names the log keeps", () => {
  test("the detector's collections give the codes, with no versions", () => {
    expect(
      deviceFromNames({
        browser: "Chrome Mobile",
        os: "GNU/Linux",
        deviceType: "smartphone",
        brand: "Samsung",
        model: null,
        isBot: false,
      }),
    ).toMatchObject({
      browserCode: "CM",
      browserVersion: null,
      osCode: "LIN",
      osVersion: null,
      osFamily: "GNU/Linux",
      brandCode: "SA",
    });
  });

  test("a name the detector does not know gives no code", () => {
    expect(
      deviceFromNames({
        browser: "Nothing Browser",
        os: "Nothing OS",
        deviceType: null,
        brand: "Nothing Inc",
        model: null,
        isBot: false,
      }),
    ).toMatchObject({
      browserCode: null,
      os: "Nothing OS",
      osCode: null,
      osFamily: null,
      brandCode: null,
    });
  });
});
