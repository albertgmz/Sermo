import { expect, test } from "bun:test";
import {
  deviceName,
  deviceStatus,
  keepsSubscription,
  keyBytes,
  sameEndpoint,
} from "./push-device";

const ENDPOINT = "https://fcm.googleapis.com/fcm/send/abc";
const on = {
  serverPush: true,
  availability: "available" as const,
  permission: "granted" as const,
  endpoint: ENDPOINT,
  listed: [ENDPOINT],
};

test("this device is on only when the browser holds a subscription the account lists", () => {
  expect(deviceStatus(on)).toBe("on");
  expect(deviceStatus({ ...on, listed: [] })).toBe("off");
  expect(deviceStatus({ ...on, endpoint: null })).toBe("off");
  expect(deviceStatus({ ...on, permission: "default" })).toBe("off");
  expect(deviceStatus({ ...on, permission: "denied" })).toBe("blocked");
});

test("what stops this device comes before its own state", () => {
  expect(deviceStatus({ ...on, serverPush: false })).toBe("off-site");
  expect(deviceStatus({ ...on, availability: "unsupported" })).toBe(
    "unsupported",
  );
  expect(deviceStatus({ ...on, availability: "needsInstall" })).toBe(
    "needsInstall",
  );
});

test("endpoints compare as the backend normalizes them", () => {
  expect(
    sameEndpoint(
      "https://FCM.googleapis.com/fcm/send/abc",
      "https://fcm.googleapis.com/fcm/send/abc",
    ),
  ).toBe(true);
  expect(sameEndpoint(ENDPOINT, `${ENDPOINT}x`)).toBe(false);
  expect(sameEndpoint("not a url", "not a url")).toBe(true);
});

test("a device is named by its browser and system", () => {
  expect(
    deviceName(
      "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36",
    ),
  ).toEqual({ browser: "Chrome", system: "Android" });
  expect(
    deviceName(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1",
    ),
  ).toEqual({ browser: "Safari", system: "iPhone" });
  expect(
    deviceName(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0",
    ),
  ).toEqual({ browser: "Edge", system: "Windows" });
  expect(
    deviceName(
      "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0.0.0 Mobile Safari/537.36",
    ),
  ).toEqual({ browser: "Samsung Internet", system: "Android" });
  expect(
    deviceName(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:143.0) Gecko/20100101 Firefox/143.0",
    ),
  ).toEqual({ browser: "Firefox", system: "macOS" });
  expect(deviceName("")).toEqual({ browser: null, system: null });
});

test("the forum's public key reaches the browser as its bytes", () => {
  const bytes = Uint8Array.from({ length: 65 }, (_, at) => (at * 37) % 256);
  const text = Buffer.from(bytes).toString("base64url");
  expect(keyBytes(text)).toEqual(bytes);
  expect(keyBytes(`${text}=`)).toEqual(bytes);
});

test("a subscription serves only the member who turned it on, and only for the forum's key", () => {
  const keeps = (
    owner: string | null,
    member: string | null,
    keyMatches: boolean | null = true,
  ) => keepsSubscription({ owner, member, keyMatches });
  expect(keeps("7", "7")).toBe(true);
  // Another member signed in on this browser, or a guest is viewing (the session ended).
  expect(keeps("7", "8")).toBe(false);
  expect(keeps("7", null)).toBe(false);
  // Nobody is recorded: it is no one's to keep.
  expect(keeps(null, "7")).toBe(false);
  expect(keeps(null, null)).toBe(false);
  // Made for keys the forum no longer has; when the key could not be read it is not judged.
  expect(keeps("7", "7", false)).toBe(false);
  expect(keeps("7", "7", null)).toBe(true);
});
