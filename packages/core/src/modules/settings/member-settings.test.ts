import { describe, expect, test } from "bun:test";
import { createTestContext, insertUser, userActor } from "@sermo/core/testing";
import { execute } from "../../operation";
import { getOperation } from "../../operations";
import { readSiteSettings } from "./index";

describe("member settings", () => {
  test("a row stored before the member settings existed parses with their defaults", () => {
    const ctx = createTestContext();
    const old: Record<string, unknown> = { ...readSiteSettings(ctx), siteName: "Old site" };
    for (const key of [
      "levelStep",
      "levelTitles",
      "signatureMaxLength",
      "signatureMaxLines",
      "customTitleMaxLength",
      "standingPostPoints",
      "standingReactionsPerPoint",
      "standingReferralPoints",
    ])
      delete old[key];
    ctx.sqlite
      .prepare(
        "INSERT INTO site_settings (key, value, updated_at) VALUES ('configuration', ?1, 0) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
      )
      .run(JSON.stringify(old));
    const settings = readSiteSettings(ctx);
    expect(settings.siteName).toBe("Old site");
    expect(settings).toMatchObject({
      levelStep: 100,
      signatureMaxLength: 300,
      signatureMaxLines: 4,
      customTitleMaxLength: 40,
      standingPostPoints: 1,
      standingReactionsPerPoint: 10,
      standingReferralPoints: 20,
    });
    expect(settings.levelTitles.map((entry) => entry.level)).toEqual([1, 2, 4]);
  });

  test("with no stored row the defaults carry every new key", () => {
    const settings = readSiteSettings(createTestContext());
    expect(settings.levelStep).toBe(100);
    expect(settings.levelTitles).toHaveLength(3);
    expect(settings.standingReferralPoints).toBe(20);
  });

  test("levelTitles is replaced as a whole", async () => {
    const ctx = createTestContext();
    const admin = userActor(insertUser(ctx, { groupId: 4 }));
    const update = getOperation("settings.update");
    await execute(ctx, update, admin, { levelTitles: [{ level: 3, title: "Veteran" }] });
    expect(readSiteSettings(ctx).levelTitles).toEqual([{ level: 3, title: "Veteran" }]);
    await execute(ctx, update, admin, { levelStep: 50 });
    expect(readSiteSettings(ctx)).toMatchObject({
      levelStep: 50,
      levelTitles: [{ level: 3, title: "Veteran" }],
    });
  });
});
