import { afterEach, describe, expect, test } from "bun:test";
import { GUEST } from "../../actor";
import { accounts, closeAll, PASSWORD } from "../admin/fixtures.test";
import { getAuth } from "../auth";
import { deviceOf } from "./device";
import { memberDeviceOf } from "./member-device";

afterEach(closeAll);

const ANDROID_CHROME =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36";
const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const IPAD_SAFARI =
  "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const MAC_SAFARI =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
const WINDOWS_EDGE =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0";
const LINUX_CHROME =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";
const GOOGLEBOT = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";

describe("memberDeviceOf: what a member's latest sign-in shows of their device", () => {
  test("Android Chrome is a phone on Android with Chrome", () => {
    expect(memberDeviceOf(deviceOf(ANDROID_CHROME))).toEqual({
      type: "phone",
      os: "Android",
      browser: "Chrome",
    });
  });

  test("the systems and browsers get the names people know", () => {
    expect(memberDeviceOf(deviceOf(IPHONE_SAFARI))).toEqual({
      type: "phone",
      os: "iOS",
      browser: "Safari",
    });
    expect(memberDeviceOf(deviceOf(IPAD_SAFARI))).toEqual({
      type: "tablet",
      os: "iPadOS",
      browser: "Safari",
    });
    expect(memberDeviceOf(deviceOf(MAC_SAFARI))).toEqual({
      type: "desktop",
      os: "macOS",
      browser: "Safari",
    });
    expect(memberDeviceOf(deviceOf(WINDOWS_EDGE))).toEqual({
      type: "desktop",
      os: "Windows",
      browser: "Microsoft Edge",
    });
    expect(memberDeviceOf(deviceOf(LINUX_CHROME))).toEqual({
      type: "desktop",
      os: "Linux",
      browser: "Chrome",
    });
  });

  test("a device type other than a computer, a phone or a tablet keeps the system alone", () => {
    expect(
      memberDeviceOf({
        browser: null,
        os: "Tizen",
        deviceType: "tv",
        brand: null,
        model: null,
        isBot: false,
      }),
    ).toEqual({ type: null, os: "Tizen", browser: null });
  });

  test("a crawler, an empty or an unreadable user agent shows nothing", () => {
    expect(memberDeviceOf(deviceOf(GOOGLEBOT))).toBeNull();
    expect(memberDeviceOf(deviceOf(""))).toBeNull();
    expect(memberDeviceOf(deviceOf("???"))).toBeNull();
  });
});

type W = Awaited<ReturnType<typeof accounts>>;

const signIn = (w: W, userAgent: string, email = "ada@example.test") =>
  getAuth(w.ctx).api.signInEmail({
    body: { email, password: PASSWORD },
    headers: new Headers({ "x-sermo-client-ip": "203.0.113.10", "user-agent": userAgent }),
  });

const stored = (w: W, userId: number) =>
  w.ctx.sqlite
    .prepare<
      { device_type: string | null; device_os: string | null; device_browser: string | null },
      [number]
    >("SELECT device_type, device_os, device_browser FROM users WHERE id = ?1")
    .get(userId);

const authorDevice = async (w: W, userId: number) =>
  (await w.run("users.authors", GUEST, { userIds: [userId] })).items[0].device;

describe("the member's device, from their latest sign-in", () => {
  test("a sign-in stores the parsed device on the member, never the user agent", async () => {
    const w = await accounts();
    const ada = await w.register("Ada");
    await signIn(w, ANDROID_CHROME);
    expect(stored(w, ada.id)).toEqual({
      device_type: "phone",
      device_os: "Android",
      device_browser: "Chrome",
    });
    expect(await authorDevice(w, ada.id)).toEqual({
      type: "phone",
      os: "Android",
      browser: "Chrome",
    });
    const profile = await w.run("profiles.get", GUEST, { userId: ada.id });
    expect(profile.device).toEqual({ type: "phone", os: "Android", browser: "Chrome" });
    expect(JSON.stringify(profile)).not.toContain("Pixel 8");
  });

  test("the latest sign-in wins, and one with no readable device clears it", async () => {
    const w = await accounts();
    const ada = await w.register("Ada");
    await signIn(w, ANDROID_CHROME);
    await signIn(w, MAC_SAFARI);
    expect(await authorDevice(w, ada.id)).toEqual({
      type: "desktop",
      os: "macOS",
      browser: "Safari",
    });
    await signIn(w, GOOGLEBOT);
    expect(await authorDevice(w, ada.id)).toBeNull();
  });

  test("a sign-up stores the device of the session it opens", async () => {
    const w = await accounts();
    const result = await getAuth(w.ctx).api.signUpEmail({
      body: { name: "Bea", username: "Bea", email: "bea@example.test", password: PASSWORD },
      headers: new Headers({ "x-sermo-client-ip": "203.0.113.11", "user-agent": IPHONE_SAFARI }),
    });
    expect(await authorDevice(w, Number(result.user.id))).toEqual({
      type: "phone",
      os: "iOS",
      browser: "Safari",
    });
  });

  test("a member who never signed in since has no device", async () => {
    const w = await accounts();
    const ada = await w.register("Ada");
    expect(await authorDevice(w, ada.id)).toBeNull();
    expect((await w.run("profiles.get", GUEST, { userId: ada.id })).device).toBeNull();
  });

  test("a restricted card shows no device", async () => {
    const w = await accounts();
    const ada = await w.register("Ada");
    await signIn(w, ANDROID_CHROME);
    w.ctx.sqlite
      .prepare("UPDATE users SET profile_view_privacy = 'members' WHERE id = ?1")
      .run(ada.id);
    const [author] = (await w.run("users.authors", GUEST, { userIds: [ada.id] })).items;
    expect(author.card.restricted).toBe(true);
    expect(author.device).toBeNull();
  });

  test("erasing the member clears their device", async () => {
    const w = await accounts();
    const founder = await w.register("Founder", 4);
    const ada = await w.register("Ada");
    await signIn(w, ANDROID_CHROME);
    await w.run("users.adminErase", founder.actor, {
      userId: ada.id,
      actorPassword: PASSWORD,
      reason: "Right to be forgotten",
    });
    expect(stored(w, ada.id)).toEqual({ device_type: null, device_os: null, device_browser: null });
  });
});
