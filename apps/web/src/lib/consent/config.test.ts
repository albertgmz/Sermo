import { expect, test } from "bun:test";
import en from "../../../messages/en/cookies.json";
import es from "../../../messages/es/cookies.json";
import { consentConfig, cookieDomains } from "./config";
import { CONSENT_COOKIE, INVENTORY, OPTIONAL_CATEGORIES } from "./inventory";

const config = consentConfig(
  { en: en.banner, es: es.banner },
  "es",
  3,
  "forum.example.com",
);
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
  expect(consentConfig({ en: en.banner }, "en", 4, "localhost").revision).toBe(
    4,
  );
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
});

test("the domains a tracker may have written to: this host and each parent, with and without the dot", () => {
  expect(cookieDomains("forum.example.com")).toEqual([
    "forum.example.com",
    ".forum.example.com",
    "example.com",
    ".example.com",
  ]);
  expect(cookieDomains("a.b.example.org")).toEqual([
    "a.b.example.org",
    ".a.b.example.org",
    "b.example.org",
    ".b.example.org",
    "example.org",
    ".example.org",
  ]);
  expect(cookieDomains("example.com")).toEqual(["example.com", ".example.com"]);
  expect(cookieDomains("localhost")).toEqual(["localhost", ".localhost"]);
  expect(cookieDomains("192.168.0.4")).toEqual(["192.168.0.4", ".192.168.0.4"]);
  expect(cookieDomains("[::1]")).toEqual(["[::1]", ".[::1]"]);
});

test("a withdrawn analytics category clears its cookies on the parent domain too", () => {
  const entries = cleared("analytics") as {
    name: string | RegExp;
    domain?: string;
  }[];
  const on = (name: string, domain?: string) =>
    entries.some(
      (entry) =>
        entry.domain === domain &&
        (typeof entry.name === "string"
          ? entry.name === name
          : entry.name.test(name)),
    );
  for (const domain of [
    undefined,
    "forum.example.com",
    ".forum.example.com",
    "example.com",
    ".example.com",
  ]) {
    expect(on("_ga", domain), String(domain)).toBe(true);
    expect(on("_ga_ABC123", domain), String(domain)).toBe(true);
    expect(on("_pk_id.4.ab12", domain), String(domain)).toBe(true);
  }
  expect(on("_ga", "com")).toBe(false);
  expect(on("_ga", ".com")).toBe(false);
});

test("a visitor the banner is not shown to has the choices on in the settings and no banner", () => {
  const quiet = consentConfig({ en: en.banner }, "en", 3, "forum.example.com", {
    quiet: true,
  });
  expect(quiet.autoShow).toBe(false);
  expect(quiet.mode).toBe("opt-out");
  for (const category of OPTIONAL_CATEGORIES)
    expect(quiet.categories?.[category]?.enabled, category).toBe(true);
  // The ordinary configuration shows the banner and starts with everything off.
  expect(config.autoShow).toBe(true);
  expect(config.mode).toBe("opt-in");
});

test("a category can be left out of the banner and of the settings", () => {
  const without = consentConfig({ en: en.banner }, "en", 3, "localhost", {
    omit: ["analytics"],
  });
  expect(without.categories).not.toHaveProperty("analytics");
  expect(without.categories).toHaveProperty("referrals");
  const translations = without.language?.translations as unknown as Record<
    string,
    { preferencesModal: { sections: { linkedCategory?: string }[] } }
  >;
  const sections = translations.en?.preferencesModal.sections.map(
    (section) => section.linkedCategory,
  );
  expect(sections).not.toContain("analytics");
  expect(sections).toContain("embeds");
  expect(sections).toContain("necessary");
});

test("both Accept all buttons carry the icon before their words, in every language", () => {
  const icon = '<svg aria-hidden="true"></svg>';
  const translations = consentConfig(
    { en: en.banner, es: es.banner },
    "en",
    3,
    "localhost",
    { acceptIcon: icon },
  ).language?.translations as unknown as Record<
    string,
    Record<"consentModal" | "preferencesModal", Record<string, string>>
  >;
  for (const [code, text] of [
    ["en", en.banner],
    ["es", es.banner],
  ] as const)
    for (const modal of ["consentModal", "preferencesModal"] as const) {
      expect(translations[code]?.[modal].acceptAllBtn, `${code} ${modal}`).toBe(
        `${icon}${text.acceptAll}`,
      );
      expect(translations[code]?.[modal].acceptNecessaryBtn).toBe(
        text.rejectAll,
      );
    }
});
