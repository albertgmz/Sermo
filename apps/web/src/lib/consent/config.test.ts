import { expect, test } from "bun:test";
import en from "../../../messages/en/cookies.json";
import es from "../../../messages/es/cookies.json";
import { consentConfig } from "./config";
import { CONSENT_COOKIE, INVENTORY, OPTIONAL_CATEGORIES } from "./inventory";

const config = consentConfig({ en: en.banner, es: es.banner }, "es", 3);
const cleared = (category: string) =>
  (
    config.categories as Record<
      string,
      { autoClear?: { cookies: { name: string | RegExp }[] } }
    >
  )[category]?.autoClear?.cookies ?? [];
const clears = (category: string, cookie: string) =>
  cleared(category).some(({ name }) =>
    typeof name === "string" ? name === cookie : name.test(cookie),
  );

test("nothing optional is on before a choice, and the necessary category cannot be turned off", () => {
  expect(config.mode).toBe("opt-in");
  expect(config.categories?.necessary).toEqual({
    enabled: true,
    readOnly: true,
  });
  for (const category of OPTIONAL_CATEGORIES) {
    expect(config.categories?.[category]?.enabled, category).toBe(false);
    expect(config.categories?.[category]?.readOnly, category).toBeFalsy();
  }
});

test("accept, reject and choose weigh the same, and the page stays usable", () => {
  expect(config.guiOptions?.consentModal?.equalWeightButtons).toBe(true);
  expect(config.guiOptions?.preferencesModal?.equalWeightButtons).toBe(true);
  expect(config.disablePageInteraction).toBe(false);
  const modal = config.language?.translations as unknown as Record<
    string,
    { consentModal: Record<string, string> }
  >;
  expect(modal.en.consentModal.acceptAllBtn).toBe("Accept all");
  expect(modal.en.consentModal.acceptNecessaryBtn).toBe("Reject all");
  expect(modal.es.consentModal.acceptNecessaryBtn).toBe("Rechazar todas");
});

test("the choice is stored with the policy version, and a new version asks again", () => {
  expect(config.cookie?.name).toBe(CONSENT_COOKIE);
  expect(config.revision).toBe(3);
  expect(consentConfig({ en: en.banner }, "en", 4).revision).toBe(4);
});

test("withdrawing a category clears every cookie the inventory lists for it", () => {
  for (const item of INVENTORY) {
    if (item.category === "necessary" || item.storage !== "cookie") continue;
    for (const name of item.names)
      expect(clears(item.category, name.replace(/\*$/, "x1")), name).toBe(true);
  }
  expect(clears("analytics", "_pk_id.7.ab12")).toBe(true);
  expect(clears("analytics", "_ga_ABC123")).toBe(true);
  expect(clears("analytics", "forum_locale")).toBe(false);
  expect(clears("referrals", "forum_ref")).toBe(true);
  expect(clears("analytics", "forum_ref")).toBe(false);
  // Stopping a running tracker needs a reload.
  expect(config.categories?.analytics?.autoClear?.reloadPage).toBe(true);
});
