import { afterEach, describe, expect, test } from "bun:test";
import { GUEST } from "../../actor";
import { syncPermissionRegistry } from "../../permissions";
import { accounts, closeAll, PASSWORD } from "../admin/fixtures.test";
import { getAuth } from "../auth";
import { deviceOf, NO_DEVICE } from "./device";
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

// What a stored device holds: every field, null unless the case names it.
const full = (part: object) => ({
  type: null,
  os: null,
  browser: null,
  deviceType: null,
  brand: null,
  brandCode: null,
  osCode: null,
  osVersion: null,
  osFamily: null,
  browserCode: null,
  browserVersion: null,
  ...part,
});

const ANDROID = full({
  type: "phone",
  os: "Android",
  browser: "Chrome",
  deviceType: "smartphone",
  brand: "Google",
  brandCode: "GO",
  osCode: "AND",
  osVersion: "14",
  osFamily: "Android",
  browserCode: "CM",
  browserVersion: "129.0.0.0",
});
const MAC = full({
  type: "desktop",
  os: "macOS",
  browser: "Safari",
  deviceType: "desktop",
  brand: "Apple",
  brandCode: "AP",
  osCode: "MAC",
  osVersion: "10.15.7",
  osFamily: "Mac",
  browserCode: "SF",
  browserVersion: "17.5",
});
const IPHONE = full({
  type: "phone",
  os: "iOS",
  browser: "Safari",
  deviceType: "smartphone",
  brand: "Apple",
  brandCode: "AP",
  osCode: "IOS",
  osVersion: "17.5",
  osFamily: "iOS",
  browserCode: "MF",
  browserVersion: "17.5",
});

describe("memberDeviceOf: what a member's latest sign-in shows of their device", () => {
  test("Android Chrome is a phone on Android with Chrome", () => {
    expect(memberDeviceOf(deviceOf(ANDROID_CHROME))).toEqual(ANDROID);
  });

  test("the systems and browsers get the names people know", () => {
    expect(memberDeviceOf(deviceOf(IPHONE_SAFARI))).toEqual(IPHONE);
    expect(memberDeviceOf(deviceOf(IPAD_SAFARI))).toMatchObject({
      type: "tablet",
      os: "iPadOS",
      osCode: "IPA",
      browser: "Safari",
    });
    expect(memberDeviceOf(deviceOf(MAC_SAFARI))).toEqual(MAC);
    expect(memberDeviceOf(deviceOf(WINDOWS_EDGE))).toMatchObject({
      type: "desktop",
      os: "Windows",
      osCode: "WIN",
      browser: "Microsoft Edge",
    });
    expect(memberDeviceOf(deviceOf(LINUX_CHROME))).toMatchObject({
      type: "desktop",
      os: "Linux",
      osCode: "LIN",
      browser: "Chrome",
    });
  });

  test("a device type other than a computer, a phone or a tablet keeps the system alone", () => {
    expect(memberDeviceOf({ ...NO_DEVICE, os: "Tizen", deviceType: "tv" })).toEqual(
      full({ os: "Tizen", deviceType: "tv" }),
    );
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

const authorDevice = async (w: W, userId: number, viewer: object) =>
  (await w.run("users.authors", viewer, { userIds: [userId] })).items[0].device;

describe("the member's device, from their latest sign-in", () => {
  test("a sign-in stores the parsed device on the member, never the user agent", async () => {
    const w = await accounts();
    const ada = await w.register("Ada");
    const viewer = await w.register("Viewer");
    await signIn(w, ANDROID_CHROME);
    expect(stored(w, ada.id)).toEqual({
      device_type: "phone",
      device_os: "Android",
      device_browser: "Chrome",
    });
    expect(await authorDevice(w, ada.id, viewer.actor)).toEqual(ANDROID);
    const profile = await w.run("profiles.get", viewer.actor, { userId: ada.id });
    expect(profile.device).toEqual(ANDROID);
    expect(JSON.stringify(profile)).not.toContain("Pixel 8");
  });

  test("a sign-in stores the detector's codes and versions", async () => {
    const w = await accounts();
    const ada = await w.register("Ada");
    await signIn(w, ANDROID_CHROME);
    expect(
      w.ctx.sqlite
        .prepare(
          "SELECT device_type_name, device_brand, device_brand_code, device_os_code, device_os_version, device_os_family, device_browser_code, device_browser_version FROM users WHERE id = ?1",
        )
        .get(ada.id),
    ).toEqual({
      device_type_name: "smartphone",
      device_brand: "Google",
      device_brand_code: "GO",
      device_os_code: "AND",
      device_os_version: "14",
      device_os_family: "Android",
      device_browser_code: "CM",
      device_browser_version: "129.0.0.0",
    });
  });

  test("the latest sign-in wins, and one with no readable device clears it", async () => {
    const w = await accounts();
    const ada = await w.register("Ada");
    const viewer = await w.register("Viewer");
    await signIn(w, ANDROID_CHROME);
    await signIn(w, MAC_SAFARI);
    expect(await authorDevice(w, ada.id, viewer.actor)).toEqual(MAC);
    await signIn(w, GOOGLEBOT);
    expect(await authorDevice(w, ada.id, viewer.actor)).toBeUndefined();
    expect(stored(w, ada.id)).toEqual({ device_type: null, device_os: null, device_browser: null });
  });

  test("a sign-up stores the device of the session it opens", async () => {
    const w = await accounts();
    const viewer = await w.register("Viewer");
    const result = await getAuth(w.ctx).api.signUpEmail({
      body: { name: "Bea", username: "Bea", email: "bea@example.test", password: PASSWORD },
      headers: new Headers({ "x-sermo-client-ip": "203.0.113.11", "user-agent": IPHONE_SAFARI }),
    });
    expect(await authorDevice(w, Number(result.user.id), viewer.actor)).toEqual(IPHONE);
  });

  test("a member who never signed in since has no device", async () => {
    const w = await accounts();
    const ada = await w.register("Ada");
    const viewer = await w.register("Viewer");
    expect(await authorDevice(w, ada.id, viewer.actor)).toBeUndefined();
    expect("device" in (await w.run("profiles.get", viewer.actor, { userId: ada.id }))).toBe(false);
  });

  test("a restricted card shows no device", async () => {
    const w = await accounts();
    const ada = await w.register("Ada");
    const viewer = await w.register("Viewer");
    await signIn(w, ANDROID_CHROME);
    w.ctx.sqlite
      .prepare("UPDATE users SET profile_view_privacy = 'members' WHERE id = ?1")
      .run(ada.id);
    const [author] = (await w.run("users.authors", GUEST, { userIds: [ada.id] })).items;
    expect(author.card.restricted).toBe(true);
    expect("device" in author).toBe(false);
    // A member may open the profile, so the card is whole.
    expect(await authorDevice(w, ada.id, viewer.actor)).toEqual(ANDROID);
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
    expect(
      w.ctx.sqlite
        .prepare(
          "SELECT device_type_name, device_brand, device_os_code, device_browser_code FROM users WHERE id = ?1",
        )
        .get(ada.id),
    ).toEqual({
      device_type_name: null,
      device_brand: null,
      device_os_code: null,
      device_browser_code: null,
    });
  });
});

// Who sees the device: the key is absent (not null) for anyone else, in a card and on a profile.
describe("who sees a member's device", () => {
  const seen = async (w: W, actor: object, userId: number) => {
    const [author] = (await w.run("users.authors", actor, { userIds: [userId] })).items;
    const profile = await w.run("profiles.get", actor, { userId });
    return {
      author: "device" in author ? author.device : "absent",
      profile: "device" in profile ? profile.device : "absent",
    };
  };

  async function world() {
    const w = await accounts();
    const ada = await w.register("Ada");
    const bea = await w.register("Bea");
    const moderator = await w.register("Mod", 3);
    const admin = await w.register("Admin", 4);
    await signIn(w, ANDROID_CHROME);
    return { w, ada, bea, moderator, admin };
  }

  test("a guest sees none; a member, a moderator and an administrator do", async () => {
    const { w, ada, bea, moderator, admin } = await world();
    const none = { author: "absent", profile: "absent" };
    const shown = { author: ANDROID, profile: ANDROID };
    expect(await seen(w, GUEST, ada.id)).toEqual(none);
    expect(await seen(w, bea.actor, ada.id)).toEqual(shown);
    expect(await seen(w, moderator.actor, ada.id)).toEqual(shown);
    expect(await seen(w, admin.actor, ada.id)).toEqual(shown);
  });

  test("a member who hides theirs: absent for a member and a moderator, present for an administrator and for themselves", async () => {
    const { w, ada, bea, moderator, admin } = await world();
    w.ctx.sqlite.prepare("UPDATE users SET show_device = 0 WHERE id = ?1").run(ada.id);
    const none = { author: "absent", profile: "absent" };
    const shown = { author: ANDROID, profile: ANDROID };
    expect(await seen(w, GUEST, ada.id)).toEqual(none);
    expect(await seen(w, bea.actor, ada.id)).toEqual(none);
    expect(await seen(w, moderator.actor, ada.id)).toEqual(none);
    expect(await seen(w, admin.actor, ada.id)).toEqual(shown);
    expect(await seen(w, ada.actor, ada.id)).toEqual(shown);
  });

  test("hiding the device leaves the online status alone, and the other way round", async () => {
    const { w, ada, bea } = await world();
    w.ctx.sqlite.prepare("UPDATE users SET show_online = 0 WHERE id = ?1").run(ada.id);
    expect(await seen(w, bea.actor, ada.id)).toEqual({ author: ANDROID, profile: ANDROID });
  });

  test("a member whose group is denied the permission sees none", async () => {
    const { w, ada, bea } = await world();
    w.ctx.sqlite
      .prepare(
        "UPDATE permission_entries SET value = -1 WHERE group_id = 2 AND permission_id = (SELECT id FROM permission_definitions WHERE key = 'profile.viewDevice')",
      )
      .run();
    const none = { author: "absent", profile: "absent" };
    expect(await seen(w, bea.actor, ada.id)).toEqual(none);
  });

  test("the preference is read and written, and every member starts with it on", async () => {
    const { w, ada } = await world();
    expect((await w.run("preferences.get", ada.actor)).showDevice).toBe(true);
    const updated = await w.run("preferences.update", ada.actor, { showDevice: false });
    expect(updated.showDevice).toBe(false);
    expect((await w.run("preferences.get", ada.actor)).showDevice).toBe(false);
    expect((await w.run("preferences.update", ada.actor, { showOnline: false })).showDevice).toBe(
      false,
    );
  });
});

describe("the new permissions", () => {
  const groupsOf = (w: W, key: string) =>
    w.ctx.sqlite
      .prepare<{ group_id: number; value: number }, [string]>(
        "SELECT e.group_id, e.value FROM permission_entries e JOIN permission_definitions d ON d.id = e.permission_id WHERE d.key = ?1 AND e.node_id = 0 ORDER BY e.group_id",
      )
      .all(key);
  const allowed = [
    { group_id: 2, value: 1 },
    { group_id: 3, value: 1 },
    { group_id: 4, value: 1 },
    { group_id: 5, value: 1 },
  ];

  test("viewDevice is on for every group but guests, viewHiddenDevice for administrators", async () => {
    const w = await accounts();
    expect(groupsOf(w, "profile.viewDevice")).toEqual(allowed);
    expect(groupsOf(w, "profile.viewHiddenDevice")).toEqual([{ group_id: 4, value: 1 }]);
  });

  test("an existing install gets the rows from the registry sync", async () => {
    const w = await accounts();
    const keys = ["profile.viewDevice", "profile.viewHiddenDevice"];
    for (const key of keys) {
      const id = w.ctx.sqlite
        .prepare<{ id: number }, [string]>("SELECT id FROM permission_definitions WHERE key = ?1")
        .get(key)!.id;
      w.ctx.sqlite.prepare("DELETE FROM permission_entries WHERE permission_id = ?1").run(id);
      w.ctx.sqlite.prepare("DELETE FROM permission_definitions WHERE id = ?1").run(id);
    }
    expect(syncPermissionRegistry(w.ctx)).toBe(2);
    expect(groupsOf(w, "profile.viewDevice")).toEqual(allowed);
    expect(groupsOf(w, "profile.viewHiddenDevice")).toEqual([{ group_id: 4, value: 1 }]);
  });
});
